use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tracing::{info, warn};

use crate::app_config::{
    self, SavedRoom, LIVE_STATE_ERROR, LIVE_STATE_LIVE, LIVE_STATE_OFFLINE, LIVE_STATE_UNKNOWN,
};
use crate::bilibili::types::BROWSER_USER_AGENT;

/// 开播状态查询接口（与 C# BilibiliLiveStatusProvider 一致）。
pub(crate) const LIVE_STATUS_URL: &str = "https://api.live.bilibili.com/room/v1/Room/get_info";
const MAX_ATTEMPTS: u32 = 3;
const RETRY_BASE_DELAY_MS: u64 = 500;
const MAX_CONCURRENCY: usize = 4;
const DEFAULT_INTERVAL_SECONDS: u64 = 6;
pub(crate) const MIN_INTERVAL_SECONDS: u32 = 2;
pub(crate) const MAX_INTERVAL_SECONDS: u32 = 60;
const EVENT_LIVE_STATUS_CHANGED: &str = "live-status-changed";

#[derive(Default)]
pub struct LiveMonitorState {
    checking: Arc<AtomicBool>,
}

/// 单个主播开播状态的检查结果，推送给前端刷新列表。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatusUpdate {
    pub room_id: String,
    pub live_state: String,
    pub live_title: Option<String>,
    pub live_started_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub last_error: Option<String>,
    pub just_started: bool,
}

#[derive(Debug, Clone)]
struct LiveRoomStatus {
    is_live: bool,
    title: String,
    /// 本轮开播开始时间（RFC3339）；B 站没给有效 live_time 时为 None。
    live_started_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LiveInfoResponse {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<LiveInfoData>,
}

#[derive(Debug, Deserialize)]
struct LiveInfoData {
    #[serde(default)]
    live_status: u8,
    #[serde(default)]
    title: String,
    /// 本轮开播时间，北京时间 "YYYY-MM-DD HH:MM:SS"；未开播时是 "0000-00-00 00:00:00"。
    #[serde(default)]
    live_time: String,
}

pub fn setup(app: &tauri::App) -> Result<(), String> {
    app.manage(LiveMonitorState::default());
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        run_loop(handle).await;
    });
    info!(target: "livebell::live", "live monitor started");
    Ok(())
}

async fn run_loop(app: AppHandle) {
    loop {
        if let Err(error) = check_all(&app).await {
            warn!(target: "livebell::live", error = %error, "live status check failed");
        }
        let seconds = current_interval_seconds(&app);
        tokio::time::sleep(Duration::from_secs(seconds)).await;
    }
}

fn current_interval_seconds(app: &AppHandle) -> u64 {
    app_config::read_app_config(app)
        .map(|config| {
            u64::from(
                config
                    .notification
                    .monitor_interval_seconds
                    .clamp(MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS),
            )
        })
        .unwrap_or(DEFAULT_INTERVAL_SECONDS)
}

/// 立即检查全部关注的主播开播状态（防重入：已在检查中时直接返回空结果）。
pub async fn check_all(app: &AppHandle) -> Result<Vec<LiveStatusUpdate>, String> {
    let checking = match app.try_state::<LiveMonitorState>() {
        Some(state) => state.checking.clone(),
        None => return Ok(Vec::new()),
    };

    if checking.swap(true, Ordering::SeqCst) {
        tracing::debug!(target: "livebell::live", "live status check already running");
        return Ok(Vec::new());
    }

    let result = check_all_inner(app).await;
    checking.store(false, Ordering::SeqCst);
    result
}

async fn check_all_inner(app: &AppHandle) -> Result<Vec<LiveStatusUpdate>, String> {
    let config = app_config::read_app_config(app)?;
    // 关注列表里的每个主播都要查：卡片上的开关只决定「开播时提醒不提醒」，
    // 不影响开播状态本身（关掉提醒的直播间也要能在卡片上看到是否在播）。
    let targets: Vec<(String, String, bool)> = config
        .saved_rooms
        .iter()
        .filter(|room| !room.room_id.trim().is_empty())
        .map(|room| (room.id.clone(), room.room_id.clone(), room.is_enabled))
        .collect();

    if targets.is_empty() {
        return Ok(Vec::new());
    }

    let cookie = crate::bilibili::auth::load_auth_request_context()
        .ok()
        .flatten()
        .map(|context| context.cookie_header);

    let semaphore = Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENCY));
    let mut join_set = tokio::task::JoinSet::new();
    for (id, room_id, notify_enabled) in targets {
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|error| format!("开播状态检查并发控制失败：{error}"))?;
        let cookie = cookie.clone();
        join_set.spawn(async move {
            let _permit = permit;
            let outcome = check_one(&room_id, cookie.as_deref()).await;
            (id, room_id, notify_enabled, outcome)
        });
    }

    let mut results = Vec::new();
    while let Some(joined) = join_set.join_next().await {
        match joined {
            Ok(entry) => results.push(entry),
            Err(error) => {
                warn!(target: "livebell::live", error = %error, "live status check task failed")
            }
        }
    }

    let checked_at = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut just_started_rooms: Vec<SavedRoom> = Vec::new();
    let mut updates: Vec<LiveStatusUpdate> = Vec::new();

    app_config::update_app_config_atomically(app, |config, _latest| {
        for (id, room_id, notify_enabled, outcome) in &results {
            let Some(room) = config.saved_rooms.iter_mut().find(|room| &room.id == id) else {
                continue;
            };
            let previous = room.live_state.clone();
            let (next_state, just_started) =
                summarize_live_result(&previous, *notify_enabled, outcome);
            room.live_state = next_state.to_string();
            match outcome {
                Ok(status) => {
                    room.live_title = normalize_title(&status.title);
                    room.last_error = None;
                    if status.is_live {
                        // B 站给的 real live_time 最准；没给就沿用已有值，再没有就用本轮检测时间兜底。
                        let existing = room.live_started_at.clone();
                        room.live_started_at = status
                            .live_started_at
                            .clone()
                            .or(existing)
                            .or_else(|| Some(checked_at.clone()));
                    } else {
                        // 下播后清空，下一场重新计时。
                        room.live_started_at = None;
                    }
                }
                Err(error) => {
                    room.last_error = Some(error.clone());
                }
            }
            room.last_checked_at = Some(checked_at.clone());

            if just_started {
                just_started_rooms.push(room.clone());
            }
            updates.push(LiveStatusUpdate {
                room_id: room_id.clone(),
                live_state: room.live_state.clone(),
                live_title: room.live_title.clone(),
                live_started_at: room.live_started_at.clone(),
                last_checked_at: room.last_checked_at.clone(),
                last_error: room.last_error.clone(),
                just_started,
            });
        }
    })?;

    let started_count = just_started_rooms.len();
    if !updates.is_empty() {
        let _ = app.emit(EVENT_LIVE_STATUS_CHANGED, &updates);
        info!(
            target: "livebell::live",
            checked = updates.len(),
            started = started_count,
            "live status checked"
        );
    }

    for room in just_started_rooms {
        crate::notifications::notify_live_started(app, &room);
    }

    Ok(updates)
}

/// 把一次查询结果折算成「新的开播状态」和「是否刚开播（要不要弹提醒）」。
///
/// 关注列表里的开关只管提醒：`notify_enabled = false` 时照样更新状态，
/// 只是不把这次开播算成「刚开播」，所以关着提醒期间起的播不会在之后补发。
fn summarize_live_result(
    previous: &str,
    notify_enabled: bool,
    outcome: &Result<LiveRoomStatus, String>,
) -> (&'static str, bool) {
    match outcome {
        Ok(status) if status.is_live => {
            let just_started = notify_enabled && previous != LIVE_STATE_LIVE;
            (LIVE_STATE_LIVE, just_started)
        }
        Ok(_) => (LIVE_STATE_OFFLINE, false),
        // 与 C# 一致：只有从未知态开始就一直失败，才把状态标为错误；
        // 已经查到过结果的房间保持原状态，只记错误信息。
        Err(_) if previous == LIVE_STATE_UNKNOWN => (LIVE_STATE_ERROR, false),
        Err(_) => (previous_live_state(previous), false),
    }
}

/// 把字符串形式的状态还原成静态字面量（配置里只可能是这几种）。
fn previous_live_state(state: &str) -> &'static str {
    match state {
        LIVE_STATE_LIVE => LIVE_STATE_LIVE,
        LIVE_STATE_OFFLINE => LIVE_STATE_OFFLINE,
        LIVE_STATE_ERROR => LIVE_STATE_ERROR,
        _ => LIVE_STATE_UNKNOWN,
    }
}

async fn check_one(room_id: &str, cookie: Option<&str>) -> Result<LiveRoomStatus, String> {
    let mut last_error = String::new();
    for attempt in 0..MAX_ATTEMPTS {
        match fetch_live_status(room_id, cookie).await {
            Ok(status) => return Ok(status),
            Err(error) => {
                last_error = error;
                if attempt + 1 < MAX_ATTEMPTS {
                    let delay = RETRY_BASE_DELAY_MS * (1u64 << attempt);
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
            }
        }
    }
    Err(last_error)
}

async fn fetch_live_status(room_id: &str, cookie: Option<&str>) -> Result<LiveRoomStatus, String> {
    let mut request = reqwest::Client::new()
        .get(LIVE_STATUS_URL)
        .header(reqwest::header::ACCEPT, "application/json, text/plain, */*")
        .header(reqwest::header::USER_AGENT, BROWSER_USER_AGENT)
        .header(reqwest::header::REFERER, "https://live.bilibili.com/")
        .query(&[("room_id", room_id)]);

    if let Some(cookie) = cookie.filter(|value| !value.trim().is_empty()) {
        request = request.header(reqwest::header::COOKIE, cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("开播状态请求失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("开播状态响应读取失败：{error}"))?;

    if !status.is_success() {
        return Err(format!(
            "开播状态请求返回 HTTP {status}：{}",
            crate::bilibili::types::response_preview(&bytes)
        ));
    }

    let parsed: LiveInfoResponse = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "开播状态响应解析失败：{error}：{}",
            crate::bilibili::types::response_preview(&bytes)
        )
    })?;

    if parsed.code != 0 {
        return Err(format!(
            "开播状态返回错误：code={} message={}",
            parsed.code, parsed.message
        ));
    }

    let data = parsed
        .data
        .ok_or_else(|| "开播状态响应缺少 data 字段".to_string())?;

    Ok(LiveRoomStatus {
        is_live: data.live_status == 1,
        title: data.title,
        live_started_at: parse_live_started_at(&data.live_time),
    })
}

/// 把 B 站的 `live_time`（北京时间 "YYYY-MM-DD HH:MM:SS"）解析成 RFC3339。
/// 未开播时 B 站返回 "0000-00-00 00:00:00"，一律当没有。
fn parse_live_started_at(live_time: &str) -> Option<String> {
    use chrono::{FixedOffset, NaiveDateTime, TimeZone};

    let trimmed = live_time.trim();
    if trimmed.is_empty() || trimmed.starts_with("0000-00-00") {
        return None;
    }
    let naive = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S").ok()?;
    let offset = FixedOffset::east_opt(8 * 3600)?;
    offset
        .from_local_datetime(&naive)
        .single()
        .map(|started| started.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn normalize_title(title: &str) -> Option<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[tauri::command]
pub async fn live_check_now(app: AppHandle) -> Result<Vec<LiveStatusUpdate>, String> {
    check_all(&app).await
}

/// 单个房间的即时状态（连接房间窗口用，不进关注列表、不写配置）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRoomCheck {
    pub room_id: String,
    pub is_live: bool,
    pub title: String,
}

/// 连接房间窗口用：查一个房间是否在播。失败直接把错误交给前端提示，
/// 不做轮询那套 3 次重试（对话框要即时反馈，不宜卡住）。
#[tauri::command]
pub async fn live_check_room(room_id: String) -> Result<LiveRoomCheck, String> {
    let trimmed = room_id.trim();
    if trimmed.is_empty() {
        return Err("房间号不能为空。".to_string());
    }

    let cookie = crate::bilibili::auth::load_auth_request_context()
        .ok()
        .flatten()
        .map(|context| context.cookie_header);
    let status = fetch_live_status(trimmed, cookie.as_deref()).await?;

    Ok(LiveRoomCheck {
        room_id: trimmed.to_string(),
        is_live: status.is_live,
        title: status.title,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live_status(is_live: bool) -> Result<LiveRoomStatus, String> {
        Ok(LiveRoomStatus {
            is_live,
            title: "标题".to_string(),
            live_started_at: Some("2026-10-21T20:15:00.000+08:00".to_string()),
        })
    }

    #[test]
    fn parses_bilibili_live_time_as_beijing_time() {
        assert_eq!(
            parse_live_started_at("2026-10-21 20:15:00").as_deref(),
            Some("2026-10-21T20:15:00.000+08:00")
        );
        assert_eq!(parse_live_started_at("0000-00-00 00:00:00"), None);
        assert_eq!(parse_live_started_at(""), None);
        assert_eq!(parse_live_started_at("not-a-time"), None);
    }

    /// 关注列表里的开关只决定提醒，不决定是否轮询：关掉提醒的直播间也要被查。
    #[test]
    fn muted_room_still_updates_state_without_notifying() {
        let (state, just_started) =
            summarize_live_result(LIVE_STATE_OFFLINE, false, &live_status(true));

        assert_eq!(state, LIVE_STATE_LIVE);
        assert!(!just_started, "关掉提醒的直播间开播时不能弹提醒");
    }

    #[test]
    fn enabled_room_reports_just_started_once() {
        let status = live_status(true);

        let (state, just_started) =
            summarize_live_result(LIVE_STATE_OFFLINE, true, &status);
        assert_eq!(state, LIVE_STATE_LIVE);
        assert!(just_started);

        // 已经在播了，下一轮不能再算一次「刚开播」。
        let (_, again) = summarize_live_result(LIVE_STATE_LIVE, true, &status);
        assert!(!again);
    }

    #[test]
    fn fetch_errors_keep_known_state() {
        let error = Err::<LiveRoomStatus, String>("网络错误".to_string());
        let (state, just_started) = summarize_live_result(LIVE_STATE_LIVE, true, &error);
        assert_eq!(state, LIVE_STATE_LIVE);
        assert!(!just_started);

        let (state, _) = summarize_live_result(LIVE_STATE_UNKNOWN, true, &error);
        assert_eq!(state, LIVE_STATE_ERROR);
    }

    #[test]
    fn offline_result_clears_live_state() {
        let (state, just_started) =
            summarize_live_result(LIVE_STATE_LIVE, true, &live_status(false));
        assert_eq!(state, LIVE_STATE_OFFLINE);
        assert!(!just_started);
    }
}
