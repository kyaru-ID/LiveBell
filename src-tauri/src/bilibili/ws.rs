use super::auth;
use super::cookies::merge_cookie_headers;
use super::errors::classify_connection_error;
use super::filter_runtime::{FilterRuntimeOwner, FilterRuntimeState};
use super::http;
use super::protocol;
use super::recording::{preserve_event_batch, DanmakuRecorder};
use super::room_manager::{
    RoomConnectionManager, RoomSessionSnapshot, RoomSessionStatus, SessionLease, TakenSessionTask,
    ROOM_SESSIONS_EVENT,
};
use super::sc_dedup::SuperChatDedupWindow;
use super::types::{
    DanmakuRoomBatch, DeviceCookie, LiveMessage, DANMAKU_BUFFER_MAX,
    DANMAKU_FLUSH_INTERVAL, HEARTBEAT_INTERVAL, RECONNECT_DELAYS,
};
use chrono::Local;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

/// 同接数事件（对齐 C# 老版 DanmakuClient.OnlineCountChanged）。
/// 载荷：{ sessionId, roomId, online }；online 为 null 表示清空徽章。
/// 它与弹幕消息是两条并列的通道，同一帧里可能只有它、没有可显示消息。
pub(crate) const ONLINE_COUNT_EVENT: &str = "online-count-changed";

// ── Tauri commands ──

// 用 async 命令：同步命令跑在主线程上，而下面的 window.show() 需要主线程继续跑事件循环。
#[tauri::command]
pub async fn connect_bilibili_room(
    app: AppHandle,
    requested_room_id: u64,
) -> Result<RoomSessionSnapshot, String> {
    // 支持同时连接多个直播间（用户要求做回来）。新会话直接 reserve，已有的不动；
    // 上限由 RoomConnectionManager 把关（MAX_ACTIVE_ROOM_SESSIONS）。
    let manager = app.state::<RoomConnectionManager>();
    let lease = manager.reserve(requested_room_id)?;
    if let Err(error) = emit_room_sessions(&app) {
        let _ = manager.invalidate(&lease.session_id);
        return Err(error);
    }
    if !manager.is_current(&lease) {
        return Err("会话已失效".to_string());
    }
    let task_app = app.clone();
    let task_lease = lease.clone();
    let completion_guard = lease.completion_guard();
    let (start_sender, start_receiver) = oneshot::channel();
    let task = tauri::async_runtime::spawn(async move {
        let _completion_guard = completion_guard;
        if start_receiver.await.is_ok() {
            run_with_reconnect(task_app, task_lease).await;
        }
    });
    if let Err(error) = manager.install_task(&lease, task) {
        return Err(error);
    }
    let _ = start_sender.send(());

    // 弹幕层默认不显示（tauri.conf.json 里 main 窗口 visible=false）：连上第一个房间后再出现，
    // 对齐 C# 老版「启动只显示主窗口、连房间后才有弹幕窗」。之后仍可由托盘/快捷键手动显示或隐藏。
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            warn!(
                target: "livebell::bilibili",
                error = %error,
                "failed to show overlay window after connecting"
            );
        }
        // show() 之后必须重新应用鼠标穿透，否则弹幕层会拦住整片区域的点击（用户报的 bug）。
        if let Err(error) = crate::window_control::sync_click_through(&app) {
            warn!(
                target: "livebell::bilibili",
                error = %error,
                "failed to re-apply click-through after showing overlay window"
            );
        }
    }

    current_session_snapshot(&app, &lease)
}

#[tauri::command]
pub async fn disconnect_bilibili_room(
    app: AppHandle,
    session_id: String,
) -> Result<Vec<RoomSessionSnapshot>, String> {
    let manager = app.state::<RoomConnectionManager>();
    let room_owners = manager
        .resolved_room_leases()?
        .into_iter()
        .filter(|(_, lease)| lease.session_id == session_id)
        .map(|(room_id, lease)| (room_id, FilterRuntimeOwner::from_lease(&lease)))
        .collect();
    let task = manager.take_task(&session_id)?;
    if let Some(task) = task {
        terminate_taken_tasks(vec![task]).await;
    }
    manager.invalidate_taken(&session_id)?;
    remove_filter_rooms(&app, room_owners)?;
    emit_room_sessions(&app)?;
    manager.snapshot()
}

#[tauri::command]
pub async fn disconnect_all_bilibili_rooms(
    app: AppHandle,
) -> Result<Vec<RoomSessionSnapshot>, String> {
    disconnect_all_sessions(&app).await
}

#[tauri::command]
pub fn get_bilibili_room_sessions(app: AppHandle) -> Result<Vec<RoomSessionSnapshot>, String> {
    app.state::<RoomConnectionManager>().snapshot()
}

async fn disconnect_all_sessions(app: &AppHandle) -> Result<Vec<RoomSessionSnapshot>, String> {
    let manager = app.state::<RoomConnectionManager>();
    let room_owners = filter_room_owners(&manager)?;
    let tasks = manager.take_all_tasks()?;
    terminate_taken_tasks(tasks).await;
    manager.invalidate_all_taken()?;
    remove_filter_rooms(app, room_owners)?;
    emit_room_sessions(app)?;
    manager.snapshot()
}

fn filter_room_owners(
    manager: &RoomConnectionManager,
) -> Result<Vec<(u64, FilterRuntimeOwner)>, String> {
    manager.resolved_room_leases().map(|room_leases| {
        room_leases
            .into_iter()
            .map(|(room_id, lease)| (room_id, FilterRuntimeOwner::from_lease(&lease)))
            .collect()
    })
}

fn remove_filter_rooms(
    app: &AppHandle,
    room_owners: Vec<(u64, FilterRuntimeOwner)>,
) -> Result<(), String> {
    let filter_state = app.state::<FilterRuntimeState>();
    filter_state.remove_rooms_if_owned_and_emit(app, room_owners)?;
    Ok(())
}

async fn terminate_taken_tasks(tasks: Vec<TakenSessionTask>) {
    for task in &tasks {
        task.abort();
    }
    for task in tasks {
        task.wait().await;
    }
}

#[derive(Debug, Clone)]
struct RequestIdentity {
    uid: u64,
    cookie: String,
    is_authenticated: bool,
}

// ── Connection loop ──

async fn run_with_reconnect(app: AppHandle, lease: SessionLease) {
    info!(
        target: "livebell::bilibili",
        session_id = %lease.session_id,
        "starting danmaku connection task"
    );

    let mut attempt = 0usize;
    let mut super_chat_dedup = SuperChatDedupWindow::default();
    loop {
        if !app.state::<RoomConnectionManager>().is_current(&lease) {
            break;
        }
        match connect_room(app.clone(), &lease, &mut super_chat_dedup).await {
            // 弹幕连接正常结束时（服务器关闭连接）走 Err 分支重连，Ok 只是形式上的完备分支。
            Ok(()) => {}
            Err(error) => {
                if !app.state::<RoomConnectionManager>().is_current(&lease) {
                    break;
                }
                if error == "该直播间已经连接" || error == "直播间解析结果已变化"
                {
                    let _ =
                        publish_session_status(&app, &lease, RoomSessionStatus::Error, error, None);
                    break;
                }
                let user_error = classify_connection_error(&error);
                if user_error.is_terminal {
                    let status = match user_error.status {
                        "invalid_room" => RoomSessionStatus::InvalidRoom,
                        _ => RoomSessionStatus::Error,
                    };
                    let _ = publish_session_status(&app, &lease, status, user_error.message, None);
                    break;
                }

                let delay = RECONNECT_DELAYS[attempt.min(RECONNECT_DELAYS.len() - 1)];
                warn!(
                    target: "livebell::bilibili",
                    session_id = %lease.session_id,
                    attempt,
                    delay_seconds = delay.as_secs(),
                    error = %error,
                    "danmaku connection failed; scheduling reconnect"
                );
                let live_status = current_session_snapshot(&app, &lease)
                    .ok()
                    .and_then(|snapshot| snapshot.live_status);
                if publish_session_status(
                    &app,
                    &lease,
                    RoomSessionStatus::Reconnecting,
                    format!("{}，{} 秒后重试", user_error.message, delay.as_secs()),
                    live_status,
                )
                .is_err()
                {
                    break;
                }
                tokio::time::sleep(delay).await;
                if !app.state::<RoomConnectionManager>().is_current(&lease) {
                    break;
                }
                attempt += 1;
            }
        }
    }
}

async fn connect_room(
    app: AppHandle,
    lease: &SessionLease,
    super_chat_dedup: &mut SuperChatDedupWindow,
) -> Result<(), String> {
    let requested_room_id = current_session_snapshot(&app, lease)?.requested_room_id;
    let room_init = http::fetch_room_init(requested_room_id).await?;
    ensure_current(&app, lease)?;
    let room_id = room_init.room_id;
    let first_binding =
        app.state::<RoomConnectionManager>()
            .resolve_room(lease, room_id, room_init.uid)?;
    if first_binding {
        ensure_current(&app, lease)?;
        app.state::<FilterRuntimeState>().reset_room_and_emit(
            &app,
            room_id,
            FilterRuntimeOwner::from_lease(lease),
        )?;
    }
    info!(
        target: "livebell::bilibili.http",
        room_id,
        anchor_uid = room_init.uid,
        live_status = room_init.live_status,
        "resolved room init info"
    );
    let fan_medal_name = match http::fetch_anchor_fan_medal_name(room_init.uid).await {
        Ok(fan_medal_name) => fan_medal_name,
        Err(_) => {
            warn!(
                target: "livebell::bilibili.http",
                "anonymous fan medal metadata request failed; continuing without fan medal metadata"
            );
            None
        }
    };
    ensure_current(&app, lease)?;
    let device = http::fetch_buvid().await?;
    ensure_current(&app, lease)?;
    let mut request_identity = build_request_identity(&device);
    let mut anchor_name =
        http::resolve_anchor_name(room_id, room_init.uid, &request_identity.cookie).await;
    ensure_current(&app, lease)?;
    if anchor_name.is_none() && request_identity.is_authenticated {
        warn!(
            target: "livebell::bilibili.http",
            room_id,
            "authenticated anchor metadata requests failed; retrying anonymously"
        );
        anchor_name = http::resolve_anchor_name(room_id, room_init.uid, &device.cookie).await;
        ensure_current(&app, lease)?;
    }
    app.state::<RoomConnectionManager>().set_metadata(
        lease,
        anchor_name.clone(),
        fan_medal_name.clone(),
    )?;

    // 头像单独去取：下载要走网络（几百毫秒到几秒），不能卡在连接流程里。
    // 取到后刷新一次会话快照，临时连接的卡片就能显示主播头像。
    spawn_anchor_avatar(app.clone(), lease.clone(), room_id);

    // 未开播也照连（对齐 C# 老版：点「连接」就连，不带开播判断）。
    // B 站弹幕服务器对未开播房间一样返回 getDanmuInfo，只是暂时没有弹幕；
    // 等主播开播后同一条连接就能收到消息，不用手动重连。
    if room_init.live_status != 1 {
        info!(
            target: "livebell::bilibili",
            room_id,
            live_status = room_init.live_status,
            "room is not live; connecting danmaku anyway"
        );
    }

    let danmu_info = match http::fetch_danmu_info(room_id, &request_identity.cookie).await {
        Ok(danmu_info) => danmu_info,
        Err(error) if request_identity.is_authenticated => {
            warn!(
                target: "livebell::bilibili.http",
                room_id,
                error = %error,
                "authenticated getDanmuInfo failed; retrying anonymously"
            );
            request_identity = anonymous_request_identity(&device);
            http::fetch_danmu_info(room_id, &request_identity.cookie).await?
        }
        Err(error) => return Err(error),
    };
    ensure_current(&app, lease)?;
    let host = danmu_info
        .host_list
        .first()
        .ok_or_else(|| "B 站没有返回弹幕服务器地址".to_string())?;
    let url = format!("wss://{}:{}/sub", host.host, host.wss_port);

    info!(target: "livebell::bilibili.ws", room_id, url = %url, "connecting websocket");
    publish_session_status(
        &app,
        lease,
        RoomSessionStatus::Connecting,
        format!("正在连接 {}", host.host),
        Some(room_init.live_status),
    )?;
    // 握手要带 Origin 与 Cookie（对齐 C# 老版 DanmakuClient.PumpAsync 之前那段）：
    // 缺 Origin 时 B 站弹幕服务器只下发同接数这类低频包，不下发弹幕。
    let mut request = url
        .into_client_request()
        .map_err(|error| format!("WebSocket 请求构造失败：{}", error))?;
    request.headers_mut().insert(
        "Origin",
        HeaderValue::from_static("https://live.bilibili.com"),
    );
    if !request_identity.cookie.is_empty() {
        match HeaderValue::from_str(&request_identity.cookie) {
            Ok(value) => {
                request.headers_mut().insert("Cookie", value);
            }
            Err(error) => warn!(
                target: "livebell::bilibili.ws",
                room_id,
                error = %error,
                "failed to attach cookie to websocket handshake"
            ),
        }
    }
    let (socket, _) = connect_async(request)
        .await
        .map_err(|error| format!("WebSocket 连接失败：{}", error))?;
    ensure_current(&app, lease)?;
    let (mut writer, mut reader) = socket.split();

    let auth_body = json!({
        "uid": request_identity.uid,
        "roomid": room_id,
        "protover": 2,
        "buvid": device.buvid3,
        "platform": "web",
        "type": 2,
        "key": danmu_info.token,
    });
    ensure_current(&app, lease)?;
    writer
        .send(Message::Binary(
            protocol::build_packet(7, 1, auth_body.to_string().as_bytes()).into(),
        ))
        .await
        .map_err(|error| format!("认证包发送失败：{}", error))?;

    info!(target: "livebell::bilibili.ws", room_id, "auth packet sent");
    publish_session_status(
        &app,
        lease,
        RoomSessionStatus::Connected,
        format!("已连接直播间 {}", room_id),
        Some(room_init.live_status),
    )?;
    let mut heartbeat = tokio::time::interval(HEARTBEAT_INTERVAL);
    let mut danmaku_buffer: Vec<LiveMessage> = Vec::new();
    let mut danmaku_flush = tokio::time::interval(DANMAKU_FLUSH_INTERVAL);
    let self_uid = request_identity
        .is_authenticated
        .then_some(request_identity.uid)
        .filter(|uid| *uid != 0);

    let status_lease = lease.clone();
    let status_emitter = |app: &AppHandle, _status: &str, message: &str| {
        let _ = publish_session_status(
            app,
            &status_lease,
            RoomSessionStatus::Connected,
            message,
            Some(room_init.live_status),
        );
    };

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                ensure_current(&app, lease)?;
                debug!(target: "livebell::bilibili.ws", room_id, "sending heartbeat");
                writer
                    .send(Message::Binary(
                        protocol::build_packet(2, 1, b"[Object object]").into(),
                    ))
                    .await
                    .map_err(|error| format!("心跳发送失败：{}", error))?;
            }
            _ = danmaku_flush.tick() => {
                ensure_current(&app, lease)?;
                if !danmaku_buffer.is_empty() {
                    let batch: Vec<LiveMessage> = danmaku_buffer.drain(..).collect();
                    debug!(target: "livebell::bilibili.ws", count = batch.len(), "flushing danmaku batch");
                    emit_danmaku_batch(
                        &app,
                        lease,
                        room_id,
                        anchor_name.as_deref(),
                        fan_medal_name.as_deref(),
                        batch,
                    );
                }
            }
            message = reader.next() => {
                match message {
                    Some(Ok(Message::Binary(bytes))) => {
                        let outcome = protocol::handle_packet(
                            &app,
                            &status_emitter,
                            room_id,
                            room_init.uid,
                            self_uid,
                            &bytes,
                        )?;
                        if let Some(online) = outcome.online_count {
                            emit_online_count(&app, lease, room_id, Some(online));
                        }
                        let messages =
                            super_chat_dedup.retain_new(room_id, outcome.messages);
                        danmaku_buffer.extend(messages);
                        if danmaku_buffer.len() >= DANMAKU_BUFFER_MAX {
                            ensure_current(&app, lease)?;
                            let batch: Vec<LiveMessage> = danmaku_buffer.drain(..).collect();
                            warn!(target: "livebell::bilibili.ws", count = batch.len(), "danmaku buffer overflow, emergency flush");
                            emit_danmaku_batch(
                                &app,
                                lease,
                                room_id,
                                anchor_name.as_deref(),
                                fan_medal_name.as_deref(),
                                batch,
                            );
                        }
                    }
                    Some(Ok(Message::Close(_))) => return Err("服务器关闭连接".to_string()),
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(format!("WebSocket 读取失败：{}", error)),
                    None => return Err("WebSocket 连接结束".to_string()),
                }
            }
        }
    }
}

fn ensure_current(app: &AppHandle, lease: &SessionLease) -> Result<(), String> {
    app.state::<RoomConnectionManager>()
        .is_current(lease)
        .then_some(())
        .ok_or_else(|| "会话已失效".to_string())
}

fn current_session_snapshot(
    app: &AppHandle,
    lease: &SessionLease,
) -> Result<RoomSessionSnapshot, String> {
    app.state::<RoomConnectionManager>()
        .snapshot()?
        .into_iter()
        .find(|snapshot| snapshot.session_id == lease.session_id)
        .ok_or_else(|| "会话已失效".to_string())
}

/// 把同接数推给前端，弹幕层右上角渲染成胶囊徽章。
fn emit_online_count(app: &AppHandle, lease: &SessionLease, room_id: u64, online: Option<u64>) {
    let payload = json!({
        "sessionId": lease.session_id,
        "roomId": room_id,
        "online": online,
    });
    if let Err(error) = app.emit(ONLINE_COUNT_EVENT, payload) {
        warn!(
            target: "livebell::bilibili.ws",
            error = %error,
            "failed to emit online count"
        );
    }
}

/// 连上直播间后异步补齐主播头像（临时连接的卡片要显示头像）。
/// 头像下载失败只记日志：它只是卡片上的一张图，不该影响弹幕连接。
fn spawn_anchor_avatar(app: AppHandle, lease: SessionLease, room_id: u64) {
    tauri::async_runtime::spawn(async move {
        let Some(path) = super::avatar_cache::ensure_room_avatar(&app, room_id).await else {
            return;
        };
        let manager = app.state::<RoomConnectionManager>();
        if manager.set_anchor_avatar(&lease, Some(path)).is_err() {
            // 会话已经被断开：头像没人要了，直接丢掉。
            return;
        }
        if let Err(error) = emit_room_sessions(&app) {
            warn!(
                target: "livebell::bilibili.ws",
                error = %error,
                "failed to emit room sessions after avatar cache"
            );
        }
    });
}

fn emit_room_sessions(app: &AppHandle) -> Result<(), String> {
    app.state::<RoomConnectionManager>()
        .publish_snapshot_with(|snapshots| {
            app.emit(ROOM_SESSIONS_EVENT, snapshots)
                .map_err(|error| error.to_string())
        })
}

fn publish_session_status(
    app: &AppHandle,
    lease: &SessionLease,
    status: RoomSessionStatus,
    message: impl Into<String>,
    live_status: Option<u8>,
) -> Result<bool, String> {
    let manager = app.state::<RoomConnectionManager>();
    if !manager.is_current(lease) {
        return Ok(false);
    }

    let message = message.into();
    manager.update_status(lease, status, message.clone(), live_status)?;
    if !manager.is_current(lease) {
        return Ok(false);
    }
    emit_room_sessions(app)?;
    if !manager.is_current(lease) {
        return Ok(false);
    }

    Ok(true)
}

fn emit_danmaku_batch(
    app: &AppHandle,
    lease: &SessionLease,
    room_id: u64,
    anchor_name: Option<&str>,
    fan_medal_name: Option<&str>,
    messages: Vec<LiveMessage>,
) {
    let manager = app.state::<RoomConnectionManager>();
    if !manager.is_current(lease) {
        return;
    }
    let active_source_count = manager.active_source_count().unwrap_or_default();
    let recorder = app.state::<DanmakuRecorder>();
    let Some(batch) = build_danmaku_room_batch(
        || manager.is_current(lease),
        lease.session_id.clone(),
        room_id,
        anchor_name,
        fan_medal_name,
        active_source_count,
        || {
            preserve_event_batch(messages, |recording_batch| {
                recorder.try_record(app, room_id, anchor_name, Local::now(), recording_batch)
            })
        },
    ) else {
        return;
    };
    if let Err(error) = app.emit("danmaku-messages", batch) {
        error!(target: "livebell::danmaku", error = %error, "danmaku-messages emit failed");
    }
}

fn build_danmaku_room_batch(
    is_current: impl Fn() -> bool,
    session_id: String,
    room_id: u64,
    anchor_name: Option<&str>,
    fan_medal_name: Option<&str>,
    active_source_count: usize,
    record: impl FnOnce() -> Vec<LiveMessage>,
) -> Option<DanmakuRoomBatch> {
    if !is_current() {
        return None;
    }
    let messages = record();
    is_current().then(|| DanmakuRoomBatch {
        session_id,
        room_id,
        anchor_name: anchor_name.map(str::to_owned),
        fan_medal_name: fan_medal_name.map(str::to_owned),
        active_source_count,
        messages,
        source_kind: None,
    })
}

fn build_request_identity(device: &DeviceCookie) -> RequestIdentity {
    match auth::load_auth_request_context() {
        Ok(Some(context)) => {
            info!(
                target: "livebell::bilibili.auth",
                uid = context.uid,
                "using authenticated bilibili request context"
            );
            RequestIdentity {
                uid: context.uid,
                cookie: merge_cookie_headers(&context.cookie_header, &device.cookie),
                is_authenticated: true,
            }
        }
        Ok(None) => anonymous_request_identity(device),
        Err(error) => {
            warn!(
                target: "livebell::bilibili.auth",
                error = %error,
                "failed to load bilibili auth context; using anonymous request context"
            );
            anonymous_request_identity(device)
        }
    }
}

fn anonymous_request_identity(device: &DeviceCookie) -> RequestIdentity {
    RequestIdentity {
        uid: 0,
        cookie: device.cookie.clone(),
        is_authenticated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bilibili::room_manager::TakenSessionTask;
    use tokio::sync::oneshot;

    fn message() -> LiveMessage {
        LiveMessage {
            id: "message-1".to_string(),
            room_id: Some(6),
            sender_uid: None,
            current_room_fan_medal: None,
            current_room_fan_medal_level: None,
            kind: super::super::types::LiveMessageKind::Danmaku,
            user: "观众".to_string(),
            text: "内容".to_string(),
            segments: None,
            is_self: false,
            is_lottery: false,
            timestamp: None,
            gift_name: None,
            gift_count: None,
            guard_level: None,
            guard_name: None,
            super_chat_price: None,
            super_chat_duration: None,
            super_chat_color: None,
            source_command: None,
            source_message_id: None,
        }
    }

    #[test]
    fn batch_builder_skips_stale_lease_before_recording() {
        let mut recorded = false;
        let batch = build_danmaku_room_batch(
            || false,
            "session-1".to_string(),
            6,
            Some("主播"),
            Some("粉丝牌"),
            2,
            || {
                recorded = true;
                vec![message()]
            },
        );

        assert!(batch.is_none());
        assert!(!recorded);
    }

    #[test]
    fn batch_builder_returns_current_lease_envelope() {
        let batch = build_danmaku_room_batch(
            || true,
            "session-1".to_string(),
            6,
            Some("主播"),
            Some("粉丝牌"),
            2,
            || vec![message()],
        )
        .expect("current lease batch");

        assert_eq!(batch.session_id, "session-1");
        assert_eq!(batch.room_id, 6);
        assert_eq!(batch.active_source_count, 2);
        assert_eq!(batch.messages.len(), 1);
    }

    struct CancellationSignal(Option<oneshot::Sender<()>>);

    impl Drop for CancellationSignal {
        fn drop(&mut self) {
            if let Some(sender) = self.0.take() {
                let _ = sender.send(());
            }
        }
    }

    #[test]
    fn anonymous_identity_uses_uid_zero_and_device_cookie() {
        let device = DeviceCookie {
            buvid3: "device3".to_string(),
            cookie: "buvid3=device3; buvid4=device4;".to_string(),
        };

        let identity = anonymous_request_identity(&device);

        assert_eq!(identity.uid, 0);
        assert_eq!(identity.cookie, device.cookie);
        assert!(!identity.is_authenticated);
    }

    #[test]
    fn captures_resolved_room_filter_owner_from_exact_lease() {
        let manager = RoomConnectionManager::default();
        let lease = manager.reserve(6).expect("reserve");
        manager.resolve_room(&lease, 66, 77).expect("resolve");

        assert_eq!(
            filter_room_owners(&manager).expect("filter room owners"),
            vec![(66, FilterRuntimeOwner::from_lease(&lease))]
        );
    }

    #[tokio::test]
    async fn terminate_taken_tasks_waits_for_every_worker() {
        let mut receivers = Vec::new();
        let mut tasks = Vec::new();
        for _ in 0..2 {
            let (sender, receiver) = oneshot::channel();
            let signal = CancellationSignal(Some(sender));
            let task = tauri::async_runtime::spawn(async move {
                let _signal = signal;
                std::future::pending().await
            });
            receivers.push(receiver);
            tasks.push(TakenSessionTask::Installed(task));
        }

        terminate_taken_tasks(tasks).await;

        for receiver in receivers {
            tokio::time::timeout(std::time::Duration::from_secs(1), receiver)
                .await
                .expect("worker termination timeout")
                .expect("worker termination signal");
        }
    }
}
