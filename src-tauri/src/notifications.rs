use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Position, WebviewUrl, WebviewWindowBuilder,
};
use tracing::{info, warn};

use crate::app_config::SavedRoom;

pub(crate) const NOTIFICATIONS_FILE: &str = "notifications.json";
const MAX_RECORDS: usize = 200;
const NOTIFICATION_WINDOW_LABEL: &str = "notification";
// 与 C# 老版 NotificationWindow.xaml 的「大档」一致：窗口 460x166，四周留 18px。
// 前端 NotificationWindow.tsx 会按实际卡片数量修正高度，这里只是创建时的初值。
const NOTIFICATION_WINDOW_WIDTH: f64 = 460.0;
const NOTIFICATION_WINDOW_HEIGHT: f64 = 166.0;
const NOTIFICATION_WINDOW_MARGIN: i32 = 18;
const EVENT_NOTIFICATIONS_CHANGED: &str = "notifications-changed";
const EVENT_NOTIFICATION_PUSH: &str = "notification-push";
const FALLBACK_TITLE: &str = "直播已开始";

static RECORD_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// 一条开播提醒记录（对应 C# Models/NotificationRecord.cs）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct NotificationRecord {
    pub id: String,
    pub time: String,
    pub streamer_name: String,
    pub title: String,
    pub room_id: String,
    pub avatar_path: Option<String>,
    pub is_read: bool,
}

impl Default for NotificationRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            time: String::new(),
            streamer_name: String::new(),
            title: String::new(),
            room_id: String::new(),
            avatar_path: None,
            is_read: false,
        }
    }
}

/// 通知历史与待展示队列（Data/notifications.json，最多 200 条）。
#[derive(Default)]
pub struct NotificationHistoryState {
    records: Mutex<Vec<NotificationRecord>>,
    pending: Mutex<Vec<NotificationRecord>>,
    loaded: AtomicBool,
}

fn notifications_path() -> Result<PathBuf, String> {
    crate::portable::data_root().map(|path| path.join(NOTIFICATIONS_FILE))
}

fn load_records() -> Vec<NotificationRecord> {
    let Ok(path) = notifications_path() else {
        return Vec::new();
    };
    let Ok(bytes) = fs::read(&path) else {
        return Vec::new();
    };
    let mut records: Vec<NotificationRecord> = serde_json::from_slice(&bytes).unwrap_or_default();
    records.sort_by(|left, right| right.time.cmp(&left.time));
    records.truncate(MAX_RECORDS);
    records
}

fn persist_records(records: &[NotificationRecord]) {
    let result = (|| -> Result<(), String> {
        let path = notifications_path()?;
        let parent = path
            .parent()
            .ok_or_else(|| "notifications path has no parent".to_string())?;
        crate::portable::ensure_dir(parent)?;
        let payload = serde_json::to_vec_pretty(records).map_err(|error| error.to_string())?;
        let temp_path = path.with_extension("json.tmp");
        fs::write(&temp_path, &payload).map_err(|error| format!("写入通知记录失败：{error}"))?;
        fs::rename(&temp_path, &path).map_err(|error| format!("保存通知记录失败：{error}"))?;
        Ok(())
    })();

    if let Err(error) = result {
        warn!(
            target: "livebell::notifications",
            error = %error,
            "failed to persist notification history"
        );
    }
}

fn ensure_loaded(state: &NotificationHistoryState) {
    if state.loaded.swap(true, Ordering::SeqCst) {
        return;
    }
    let loaded = load_records();
    if let Ok(mut records) = state.records.lock() {
        *records = loaded;
    }
}

fn snapshot(state: &NotificationHistoryState) -> Vec<NotificationRecord> {
    ensure_loaded(state);
    state
        .records
        .lock()
        .map(|records| records.clone())
        .unwrap_or_default()
}

fn emit_changed(app: &AppHandle) {
    if let Err(error) = app.emit(EVENT_NOTIFICATIONS_CHANGED, ()) {
        warn!(
            target: "livebell::notifications",
            error = %error,
            "failed to emit notifications-changed"
        );
    }
}

fn new_record_id() -> String {
    format!(
        "{}-{}",
        chrono::Local::now().timestamp_millis(),
        RECORD_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn streamer_display_name(room: &SavedRoom) -> String {
    if let Some(anchor_name) = room.anchor_name.as_ref() {
        let trimmed = anchor_name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let display_name = room.display_name.trim();
    if display_name.is_empty() {
        format!("直播间 {}", room.room_id)
    } else {
        display_name.to_string()
    }
}

/// 开播提醒入口：由 live_monitor 在检测到「非直播 → 直播」跃迁时调用。
pub fn notify_live_started(app: &AppHandle, room: &SavedRoom) {
    let streamer_name = streamer_display_name(room);
    let title = room
        .live_title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| FALLBACK_TITLE.to_string());
    push_notification(
        app,
        &streamer_name,
        &title,
        &room.room_id,
        room.avatar_path.as_deref(),
    );
}

fn push_notification(
    app: &AppHandle,
    streamer_name: &str,
    title: &str,
    room_id: &str,
    avatar_path: Option<&str>,
) {
    let record = NotificationRecord {
        id: new_record_id(),
        time: chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        streamer_name: streamer_name.to_string(),
        title: title.to_string(),
        room_id: room_id.to_string(),
        avatar_path: avatar_path.map(str::to_string),
        is_read: false,
    };

    let state = app.state::<NotificationHistoryState>();
    ensure_loaded(&state);

    let next = match state.records.lock() {
        Ok(mut records) => {
            records.insert(0, record.clone());
            if records.len() > MAX_RECORDS {
                records.truncate(MAX_RECORDS);
            }
            records.clone()
        }
        Err(error) => {
            warn!(
                target: "livebell::notifications",
                error = %error,
                "failed to lock notification history"
            );
            return;
        }
    };
    drop(state);

    persist_records(&next);
    emit_changed(app);

    match app.state::<NotificationHistoryState>().pending.lock() {
        Ok(mut pending) => pending.push(record.clone()),
        Err(error) => warn!(
            target: "livebell::notifications",
            error = %error,
            "failed to queue pending notification"
        ),
    }

    // 软件弹窗与系统通知各自独立开关（对齐 C# 老版：两种可以单独开关，也可以同时打开），
    // 但通知记录一律先写入，关掉任何开关都不影响记录。
    if popup_enabled(app) {
        show_notification_window(app, &record);
    }
    maybe_show_windows_toast(app, &record);
    info!(
        target: "livebell::notifications",
        streamer = %record.streamer_name,
        room_id = %record.room_id,
        "live started notification pushed"
    );
}

/// 右下角软件弹窗是否开启。读配置失败时按开启处理（宁可多提醒一次）。
fn popup_enabled(app: &AppHandle) -> bool {
    match crate::app_config::read_app_config(app) {
        Ok(config) => config.notification.popup_enabled,
        Err(error) => {
            warn!(
                target: "livebell::notifications",
                error = %error,
                "failed to read config for popup notification"
            );
            true
        }
    }
}

/// 系统级 Toast：按设置开关决定是否发送。
fn maybe_show_windows_toast(app: &AppHandle, record: &NotificationRecord) {
    let config = match crate::app_config::read_app_config(app) {
        Ok(config) => config,
        Err(error) => {
            warn!(
                target: "livebell::notifications",
                error = %error,
                "failed to read config for windows toast"
            );
            return;
        }
    };

    if !config.notification.windows_toast_enabled {
        return;
    }

    let room_url = format!("https://live.bilibili.com/{}", record.room_id);
    if let Err(error) = crate::toast::notify_live_started(
        &record.streamer_name,
        &record.title,
        &room_url,
        config.notification.sound_enabled,
        record.avatar_path.as_deref(),
    ) {
        warn!(
            target: "livebell::notifications",
            error = %error,
            "windows toast failed"
        );
    }
}

fn show_notification_window(app: &AppHandle, record: &NotificationRecord) {
    let Some(window) = ensure_notification_window(app) else {
        return;
    };

    if let Err(error) = window.show() {
        warn!(
            target: "livebell::notifications",
            error = %error,
            "failed to show notification window"
        );
        return;
    }

    // 刻意不调用 set_focus：提醒窗口不应抢走用户当前的输入焦点。
    if let Err(error) = app.emit_to(NOTIFICATION_WINDOW_LABEL, EVENT_NOTIFICATION_PUSH, record) {
        warn!(
            target: "livebell::notifications",
            error = %error,
            "failed to push notification to window"
        );
    }
}

fn ensure_notification_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
        return Some(window);
    }


    let window = match WebviewWindowBuilder::new(
        app,
        NOTIFICATION_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("LiveBell 通知")
    .inner_size(NOTIFICATION_WINDOW_WIDTH, NOTIFICATION_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    {
        Ok(window) => window,
        Err(error) => {
            warn!(
                target: "livebell::notifications",
                error = %error,
                "failed to create notification window"
            );
            return None;
        }
    };

    info!(target: "livebell::notifications", "notification window created");
    schedule_position_notification_window(&window);
    Some(window)
}

fn position_notification_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "primary monitor not found".to_string())?;
    let work_area = monitor.work_area();
    // work_area 与 set_position 用的都是物理像素，逻辑尺寸要乘缩放比，否则高 DPI 屏上会偏出屏幕右/下边缘。
    let scale = monitor.scale_factor();
    let width = (NOTIFICATION_WINDOW_WIDTH * scale).round() as i32;
    let height = (NOTIFICATION_WINDOW_HEIGHT * scale).round() as i32;
    let margin = (NOTIFICATION_WINDOW_MARGIN as f64 * scale).round() as i32;
    let x = work_area.position.x + work_area.size.width as i32 - width - margin;
    let y = work_area.position.y + work_area.size.height as i32 - height - margin;

    window
        .set_position(Position::Physical(PhysicalPosition::new(
            x.max(work_area.position.x),
            y.max(work_area.position.y),
        )))
        .map_err(|error| error.to_string())
}

/// 窗口刚创建时 WebView 还没就绪，定位调用会失败；这里延迟并重试，
/// 之后的精确尺寸与位置由前端 NotificationWindow 按内容高度决定。
fn schedule_position_notification_window(window: &tauri::WebviewWindow) {
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        for attempt in 0..5u32 {
            if attempt > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
            match position_notification_window(&window) {
                Ok(()) => return,
                Err(error) => {
                    if attempt == 4 {
                        warn!(
                            target: "livebell::notifications",
                            error = %error,
                            "failed to position notification window"
                        );
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub fn notifications_list(app: AppHandle) -> Result<Vec<NotificationRecord>, String> {
    let state = app.state::<NotificationHistoryState>();
    Ok(snapshot(&state))
}

#[tauri::command]
pub fn notifications_unread_count(app: AppHandle) -> Result<usize, String> {
    let state = app.state::<NotificationHistoryState>();
    Ok(snapshot(&state)
        .iter()
        .filter(|record| !record.is_read)
        .count())
}

/// 通知窗口挂载后取走待展示队列，避免窗口还没加载完就推送导致丢失。
#[tauri::command]
pub fn notifications_take_pending(app: AppHandle) -> Result<Vec<NotificationRecord>, String> {
    let state = app.state::<NotificationHistoryState>();
    let mut pending = state.pending.lock().map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
pub fn notifications_mark_read(
    app: AppHandle,
    id: String,
) -> Result<Vec<NotificationRecord>, String> {
    let next = {
        let state = app.state::<NotificationHistoryState>();
        ensure_loaded(&state);
        let mut records = state.records.lock().map_err(|error| error.to_string())?;
        let mut changed = false;
        if let Some(record) = records.iter_mut().find(|record| record.id == id) {
            if !record.is_read {
                record.is_read = true;
                changed = true;
            }
        }
        let next = records.clone();
        drop(records);
        if changed {
            persist_records(&next);
        }
        next
    };

    emit_changed(&app);
    Ok(next)
}

#[tauri::command]
pub fn notifications_mark_all_read(app: AppHandle) -> Result<Vec<NotificationRecord>, String> {
    let next = {
        let state = app.state::<NotificationHistoryState>();
        ensure_loaded(&state);
        let mut records = state.records.lock().map_err(|error| error.to_string())?;
        let mut changed = false;
        for record in records.iter_mut() {
            if !record.is_read {
                record.is_read = true;
                changed = true;
            }
        }
        let next = records.clone();
        drop(records);
        if changed {
            persist_records(&next);
        }
        next
    };

    emit_changed(&app);
    Ok(next)
}

#[tauri::command]
pub fn notifications_clear(app: AppHandle) -> Result<Vec<NotificationRecord>, String> {
    let state = app.state::<NotificationHistoryState>();
    ensure_loaded(&state);
    {
        let mut records = state.records.lock().map_err(|error| error.to_string())?;
        records.clear();
    }
    if let Ok(mut pending) = state.pending.lock() {
        pending.clear();
    }
    persist_records(&[]);
    emit_changed(&app);
    if let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
        let _ = window.hide();
    }
    info!(target: "livebell::notifications", "notification history cleared");
    Ok(Vec::new())
}

#[tauri::command]
pub fn notifications_hide_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(NOTIFICATION_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 测试提醒：有主播就用第一个主播，否则用「测试主播」，走完整提醒链路。
// 注意：必须是 async 命令。同步命令跑在主线程上，而创建窗口需要主线程
// 继续跑事件循环，二者会互相等待造成死锁。
#[tauri::command]
pub async fn notifications_test(app: AppHandle) -> Result<(), String> {
    let config = crate::app_config::read_app_config(&app)?;
    match config.saved_rooms.first() {
        Some(room) => {
            let streamer_name = streamer_display_name(room);
            push_notification(
                &app,
                &streamer_name,
                "（测试）这是一条测试提醒",
                &room.room_id,
                room.avatar_path.as_deref(),
            );
        }
        None => push_notification(&app, "测试主播", "（测试）这是一条测试提醒", "0", None),
    }
    Ok(())
}
