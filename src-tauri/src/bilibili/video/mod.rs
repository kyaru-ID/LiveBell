//! B 站视频弹幕：把点播视频的弹幕按时间轴喂进现有弹幕管线。
//!
//! 设计要点：
//! - 复用 danmaku-messages 事件：视频弹幕与直播间弹幕走同一条前端管线，
//!   过滤 / 录制 / 垂直流 / 统计全部自动生效，不需要第二套渲染。
//! - 会话 id 用 video:<cid>，room_id 填 cid（视频没有直播间号，前端按 sourceKind 区分）。
//! - 弹幕按 6 分钟一段懒加载，只放内存（用户明确不落盘缓存）。
//! - 播放时钟每 100ms tick 一次；进度条数据通过 video-danmaku-progress 事件推送。
//! - 弹幕层窗口保持整窗鼠标穿透；进度条只在编辑模式（整窗可点）里显示。

mod api;
mod proto;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use self::api::{fetch_segment, resolve_video, VideoPage, SEGMENT_MS};
use self::proto::DanmakuElem;
use crate::bilibili::types::{DanmakuRoomBatch, LiveMessage, LiveMessageKind};

/// 播放时钟的 tick 间隔。
const TICK_MS: u64 = 100;
/// 每多少个 tick 推一次进度（100ms * 2 = 200ms）。
const PROGRESS_EVERY_TICKS: u64 = 2;
/// 单批最多发多少条，避免拖动进度条后一次灌爆前端。
const MAX_BATCH_MESSAGES: usize = 300;
/// 单次 tick 最多按多少毫秒推进：系统休眠恢复 / 界面卡顿时不让位置一下跳太远。
const MAX_TICK_ELAPSED_MS: f64 = 2_000.0;
/// 距离段尾这么近就预取下一段。
const PREFETCH_AHEAD_MS: u64 = 60_000;
/// 拖动进度条后，把目标位置之前这么长一段的弹幕铺回屏幕上。
const BACKFILL_MS: u64 = 5_000;
const EVENT_BATCH: &str = "danmaku-messages";
const EVENT_CHANGED: &str = "video-danmaku-changed";
const EVENT_PROGRESS: &str = "video-danmaku-progress";

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 拉弹幕分段要带登录态：B 站对匿名请求只回抽样弹幕（实测约 1/6.3）。
/// 没登录就退回空串，请求照发，只是拿到的条数会少。
fn current_cookie() -> String {
    crate::bilibili::session::load_cookie_bundle()
        .ok()
        .flatten()
        .map(|bundle| bundle.cookie_header())
        .unwrap_or_default()
}

#[derive(Default)]
pub(crate) struct VideoDanmakuState {
    inner: Arc<Mutex<Option<VideoSession>>>,
}

struct VideoSession {
    session_id: String,
    aid: u64,
    bvid: String,
    title: String,
    pages: Vec<VideoPage>,
    page_index: usize,
    cid: u64,
    duration_ms: u64,
    position_ms: u64,
    playing: bool,
    rate: f64,
    looping: bool,
    finished: bool,
    /// 已经发到哪个时间点（左闭右开），seek 时同步成新位置避免补发。
    last_emit_ms: u64,
    /// 拖动进度条后要回填的区间 [from, to)，补发完清空。
    backfill: Option<(u64, u64)>,
    segments: HashMap<u64, Vec<DanmakuElem>>,
    loading: HashSet<u64>,
    failed: HashMap<u64, String>,
    error: Option<String>,
    /// 打开会话时的登录 Cookie：拉分段必须带，否则 B 站只返回抽样弹幕。
    cookie: String,
}

impl VideoSession {
    fn segment_count(&self) -> u64 {
        if self.duration_ms == 0 {
            return 1;
        }
        (self.duration_ms + SEGMENT_MS - 1) / SEGMENT_MS
    }

    fn segment_of(&self, position_ms: u64) -> u64 {
        (position_ms / SEGMENT_MS + 1).min(self.segment_count())
    }

    fn page_title(&self) -> String {
        self.pages
            .get(self.page_index)
            .map(|page| page.part.clone())
            .unwrap_or_default()
    }

    fn is_loading(&self) -> bool {
        !self.loading.is_empty()
    }

    fn snapshot(&self) -> VideoSnapshot {
        VideoSnapshot {
            session_id: self.session_id.clone(),
            aid: self.aid,
            bvid: self.bvid.clone(),
            title: self.title.clone(),
            cid: self.cid,
            page_index: self.page_index,
            page_title: self.page_title(),
            duration_ms: self.duration_ms,
            position_ms: self.position_ms,
            playing: self.playing,
            rate: self.rate,
            looping: self.looping,
            finished: self.finished,
            loading: self.is_loading(),
            error: self.error.clone(),
            pages: self
                .pages
                .iter()
                .enumerate()
                .map(|(index, page)| VideoPageSnapshot {
                    index,
                    page: page.page,
                    part: page.part.clone(),
                    duration_ms: page.duration_ms,
                    active: index == self.page_index,
                })
                .collect(),
        }
    }

    fn progress_event(&self) -> VideoProgressEvent {
        VideoProgressEvent {
            session_id: self.session_id.clone(),
            cid: self.cid,
            position_ms: self.position_ms,
            duration_ms: self.duration_ms,
            playing: self.playing,
            rate: self.rate,
            looping: self.looping,
            loading: self.is_loading(),
            finished: self.finished,
            error: self.error.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoPageSnapshot {
    pub index: usize,
    pub page: u32,
    pub part: String,
    pub duration_ms: u64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoSnapshot {
    pub session_id: String,
    pub aid: u64,
    pub bvid: String,
    pub title: String,
    pub cid: u64,
    pub page_index: usize,
    pub page_title: String,
    pub duration_ms: u64,
    pub position_ms: u64,
    pub playing: bool,
    pub rate: f64,
    pub looping: bool,
    pub finished: bool,
    pub loading: bool,
    pub error: Option<String>,
    pub pages: Vec<VideoPageSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoProgressEvent {
    pub session_id: String,
    pub cid: u64,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub playing: bool,
    pub rate: f64,
    pub looping: bool,
    pub loading: bool,
    pub finished: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub(crate) enum VideoControl {
    Play,
    Pause,
    // 前端按 JS 习惯发 positionMs；enum 上的 rename_all 只改变体名，不改变体字段名。
    Seek {
        #[serde(rename = "positionMs")]
        position_ms: u64,
    },
    SetRate { rate: f64 },
    SetLooping { looping: bool },
    SelectPage { index: usize },
}

fn to_live_message(cid: u64, elem: &DanmakuElem) -> LiveMessage {
    LiveMessage {
        id: format!("video-{}-{}", cid, elem.id),
        room_id: Some(cid),
        sender_uid: None,
        current_room_fan_medal: None,
        current_room_fan_medal_level: None,
        kind: LiveMessageKind::Danmaku,
        // 视频弹幕不提供昵称，只给空字符串；前端 showUsername 分支会自动省略前缀。
        user: String::new(),
        text: elem.content.clone(),
        segments: None,
        is_self: false,
        is_lottery: false,
        timestamp: Some(elem.progress_ms),
        gift_name: None,
        gift_count: None,
        guard_level: None,
        guard_name: None,
        super_chat_price: None,
        super_chat_duration: None,
        super_chat_color: None,
        source_command: Some("VIDEO_DANMAKU".to_string()),
        source_message_id: Some(elem.id.to_string()),
    }
}

fn store_segment(session: &mut VideoSession, index: u64, elems: Vec<DanmakuElem>) {
    let mut items: Vec<DanmakuElem> = elems.into_iter().filter(DanmakuElem::is_renderable).collect();
    items.sort_by_key(|elem| elem.progress_ms);
    tracing::info!(
        target: "livebell::video",
        cid = session.cid,
        index,
        count = items.len(),
        "video danmaku segment stored"
    );
    session.segments.insert(index, items);
}

fn spawn_segment_fetch(
    app: AppHandle,
    inner: Arc<Mutex<Option<VideoSession>>>,
    session_id: String,
    aid: u64,
    cid: u64,
    index: u64,
    cookie: String,
) {
    tauri::async_runtime::spawn(async move {
        let result = fetch_segment(aid, cid, index, &cookie).await;
        let mut guard = lock(&inner);
        let session = match guard.as_mut() {
            Some(session) => session,
            None => return,
        };
        if session.session_id != session_id {
            return;
        }
        session.loading.remove(&index);
        match result {
            Ok(elems) => {
                store_segment(session, index, elems);
                session.failed.remove(&index);
            }
            Err(error) => {
                tracing::warn!(
                    target: "livebell::video",
                    cid,
                    index,
                    error = %error,
                    "video danmaku segment fetch failed"
                );
                session.failed.insert(index, error.clone());
                if index == 1 && session.segments.is_empty() {
                    session.error = Some(error);
                }
            }
        }
        let snapshot = session.snapshot();
        drop(guard);
        let _ = app.emit(EVENT_CHANGED, snapshot);
    });
}

/// 按真实经过的时间换算这一 tick 该推进多少毫秒。
/// 不能直接用 TICK_MS：sleep 本身有开销、tick 里还有活儿要干，固定步进会越跑越慢
/// （实测 100ms 的 tick 实际要 ~104ms，20-30 秒就比视频慢 1 秒）。
fn advance_step(elapsed_ms: f64, rate: f64) -> u64 {
    let clamped = elapsed_ms.clamp(0.0, MAX_TICK_ELAPSED_MS);
    (clamped * rate).round() as u64
}

/// 播放时钟：推进位置、取待发弹幕、触发分段加载、推进度。
async fn tick(
    app: &AppHandle,
    inner: &Arc<Mutex<Option<VideoSession>>>,
    ticks: u64,
    elapsed_ms: f64,
) {
    let emit_progress = ticks % PROGRESS_EVERY_TICKS == 0;
    let mut fetch_jobs: Vec<(String, u64, u64, u64, String)> = Vec::new();
    let mut batch: Option<DanmakuRoomBatch> = None;
    let mut progress: Option<VideoProgressEvent> = None;

    {
        let mut guard = lock(inner);
        let session = match guard.as_mut() {
            Some(session) => session,
            None => return,
        };

        if session.playing {
            let current = session.segment_of(session.position_ms);
            // 当前段没就绪就先不推进，避免弹幕被跳过。
            if session.segments.contains_key(&current) {
                let step = advance_step(elapsed_ms, session.rate);
                session.position_ms = (session.position_ms + step).min(session.duration_ms);
                if session.position_ms >= session.duration_ms {
                    if session.looping {
                        session.position_ms = 0;
                        session.last_emit_ms = 0;
                    } else {
                        session.playing = false;
                        session.finished = true;
                    }
                }
            }
        }

        // 需要的分段：当前段 + 快到段尾时的下一段。
        let current = session.segment_of(session.position_ms);
        let total = session.segment_count();
        let mut wanted = vec![current];
        if current < total && session.position_ms + PREFETCH_AHEAD_MS >= current * SEGMENT_MS {
            wanted.push(current + 1);
        }
        for index in wanted {
            if index == 0 || index > total {
                continue;
            }
            if session.segments.contains_key(&index)
                || session.loading.contains(&index)
                || session.failed.contains_key(&index)
            {
                continue;
            }
            session.loading.insert(index);
            fetch_jobs.push((
                session.session_id.clone(),
                session.aid,
                session.cid,
                index,
                session.cookie.clone(),
            ));
        }

        let from = session.last_emit_ms;
        let to = session.position_ms;
        let mut collected: Vec<(u64, LiveMessage)> = Vec::new();

        if session.playing && to > from {
            let start_seg = session.segment_of(from);
            let end_seg = session.segment_of(to);
            for index in start_seg..=end_seg {
                if let Some(items) = session.segments.get(&index) {
                    for elem in items {
                        if elem.progress_ms >= from && elem.progress_ms < to {
                            collected.push((elem.progress_ms, to_live_message(session.cid, elem)));
                        }
                    }
                }
            }
        }

        // 拖动进度条后回填：把目标位置之前 5 秒内的弹幕一次性铺回去，
        // 让用户立刻看到「这个时间点该有的弹幕」。
        if let Some((backfill_from, backfill_to)) = session.backfill {
            let start_seg = session.segment_of(backfill_from);
            let end_seg = session.segment_of(backfill_to.saturating_sub(1));
            let mut ready = true;
            for index in start_seg..=end_seg {
                match session.segments.get(&index) {
                    Some(items) => {
                        for elem in items {
                            if elem.progress_ms >= backfill_from
                                && elem.progress_ms < backfill_to
                            {
                                collected.push((
                                    elem.progress_ms,
                                    to_live_message(session.cid, elem),
                                ));
                            }
                        }
                    }
                    None => {
                        ready = false;
                        // 这一段还没下载，先请求它，下一个 tick 再补发。
                        if !session.loading.contains(&index)
                            && !session.failed.contains_key(&index)
                        {
                            session.loading.insert(index);
                            fetch_jobs.push((
                                session.session_id.clone(),
                                session.aid,
                                session.cid,
                                index,
                                session.cookie.clone(),
                            ));
                        }
                    }
                }
            }
            if ready {
                session.backfill = None;
            }
        }

        if !collected.is_empty() {
            collected.sort_by_key(|(progress, _)| *progress);
            let truncated = collected.len() > MAX_BATCH_MESSAGES;
            if truncated {
                collected.truncate(MAX_BATCH_MESSAGES);
            }
            if session.playing && to > from {
                session.last_emit_ms = if truncated {
                    collected
                        .last()
                        .map(|(position, _)| position.saturating_add(1))
                        .unwrap_or(to)
                } else {
                    to
                };
            }
            let messages: Vec<LiveMessage> =
                collected.into_iter().map(|(_, message)| message).collect();
            batch = Some(DanmakuRoomBatch {
                session_id: session.session_id.clone(),
                room_id: session.cid,
                anchor_name: Some(session.title.clone()),
                fan_medal_name: None,
                active_source_count: 1,
                messages,
                source_kind: Some("video"),
            });
        } else if session.playing && to > from {
            session.last_emit_ms = to;
        }

        if emit_progress {
            progress = Some(session.progress_event());
        }
    }

    for (session_id, aid, cid, index, cookie) in fetch_jobs {
        spawn_segment_fetch(app.clone(), inner.clone(), session_id, aid, cid, index, cookie);
    }
    if let Some(batch) = batch {
        let has_messages = !batch.messages.is_empty();
        if has_messages {
            if let Err(error) = app.emit(EVENT_BATCH, batch) {
                tracing::warn!(
                    target: "livebell::video",
                    error = %error,
                    "video danmaku batch emit failed"
                );
            }
        }
    }
    if let Some(progress) = progress {
        let _ = app.emit(EVENT_PROGRESS, progress);
    }
}

pub(crate) fn setup(app: &AppHandle) {
    let state = app.state::<VideoDanmakuState>();
    let inner = state.inner.clone();

    let handle = app.clone();
    let ticker_inner = inner.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticks: u64 = 0;
        // 用真实经过时间推进，别用「睡多久就走多久」，否则每轮的开销会累积成越来越慢。
        let mut last = tokio::time::Instant::now();
        loop {
            tokio::time::sleep(Duration::from_millis(TICK_MS)).await;
            let now = tokio::time::Instant::now();
            let elapsed_ms = now.duration_since(last).as_secs_f64() * 1000.0;
            last = now;
            ticks = ticks.wrapping_add(1);
            tick(&handle, &ticker_inner, ticks, elapsed_ms).await;
        }
    });
}

#[tauri::command]
pub(crate) async fn open_video_danmaku(
    app: AppHandle,
    input: String,
) -> Result<VideoSnapshot, String> {
    let info = resolve_video(&input).await?;
    let page_index = info.initial_page_index(info.requested_page);
    let page = info
        .pages
        .get(page_index)
        .cloned()
        .ok_or_else(|| "视频没有分P信息".to_string())?;
    let duration_ms = if page.duration_ms > 0 {
        page.duration_ms
    } else {
        info.duration_ms
    };
    let cid = page.cid;
    let session_id = format!("video:{cid}");

    let mut session = VideoSession {
        session_id: session_id.clone(),
        aid: info.aid,
        bvid: info.bvid.clone(),
        title: info.title.clone(),
        pages: info.pages.clone(),
        page_index,
        cid,
        duration_ms,
        position_ms: 0,
        playing: false,
        rate: 1.0,
        looping: false,
        finished: false,
        last_emit_ms: 0,
        backfill: None,
        segments: HashMap::new(),
        loading: HashSet::new(),
        failed: HashMap::new(),
        error: None,
        cookie: current_cookie(),
    };

    // 先同步拉第一段：打开就能看到弹幕，比“先出进度条再加载”体验好。
    let cookie = session.cookie.clone();
    match fetch_segment(session.aid, cid, 1, &cookie).await {
        Ok(elems) => store_segment(&mut session, 1, elems),
        Err(error) => session.error = Some(error),
    }
    session.playing = session.segments.contains_key(&1);
    let snapshot = session.snapshot();

    tracing::info!(
        target: "livebell::video",
        session = %session_id,
        cid,
        duration_ms,
        error = session.error.as_deref().unwrap_or(""),
        "video danmaku session opened"
    );
    {
        let inner = app.state::<VideoDanmakuState>().inner.clone();
        *lock(&inner) = Some(session);
    }
    let _ = app.emit(EVENT_CHANGED, snapshot.clone());
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn close_video_danmaku(app: AppHandle) -> Result<(), String> {
    let inner = app.state::<VideoDanmakuState>().inner.clone();
    let had_session = lock(&inner).take().is_some();
    if had_session {
        let _ = app.emit(EVENT_CHANGED, serde_json::Value::Null);
    }
    let _ = crate::window_control::sync_click_through(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn get_video_danmaku_state(app: AppHandle) -> Option<VideoSnapshot> {
    let inner = app.state::<VideoDanmakuState>().inner.clone();
    let guard = lock(&inner);
    guard.as_ref().map(VideoSession::snapshot)
}

#[tauri::command]
pub(crate) async fn video_danmaku_control(
    app: AppHandle,
    command: VideoControl,
) -> Result<VideoSnapshot, String> {
    let inner = app.state::<VideoDanmakuState>().inner.clone();
    let mut select_page: Option<u64> = None;
    let mut snapshot;

    {
        let mut guard = lock(&inner);
        let session = match guard.as_mut() {
            Some(session) => session,
            None => return Err("当前没有打开的视频弹幕".to_string()),
        };
        match command {
            VideoControl::Play => {
                if session.finished && !session.looping {
                    session.position_ms = 0;
                    session.last_emit_ms = 0;
                    session.backfill = None;
                    session.finished = false;
                }
                session.playing = true;
                session.error = None;
            }
            VideoControl::Pause => session.playing = false,
            VideoControl::Seek { position_ms } => {
                session.position_ms = position_ms.min(session.duration_ms);
                session.last_emit_ms = session.position_ms;
                // 下一个 tick 把新位置前 5 秒的弹幕铺回屏幕。
                session.backfill = Some((
                    session.position_ms.saturating_sub(BACKFILL_MS),
                    session.position_ms,
                ));
                session.finished = false;
                tracing::info!(
                    target: "livebell::video",
                    position_ms = session.position_ms,
                    "video danmaku seek"
                );
            }
            VideoControl::SetRate { rate } => {
                session.rate = rate.clamp(0.25, 4.0);
            }
            VideoControl::SetLooping { looping } => session.looping = looping,
            VideoControl::SelectPage { index } => {
                if index >= session.pages.len() {
                    return Err(format!("分P 超出范围：{index}"));
                }
                let page = session.pages[index].clone();
                session.page_index = index;
                session.cid = page.cid;
                session.duration_ms = if page.duration_ms > 0 {
                    page.duration_ms
                } else {
                    session.duration_ms
                };
                session.session_id = format!("video:{}", page.cid);
                session.position_ms = 0;
                session.last_emit_ms = 0;
                session.backfill = None;
                session.finished = false;
                session.error = None;
                session.segments.clear();
                session.loading.clear();
                session.failed.clear();
                session.playing = true;
                select_page = Some(page.cid);
            }
        }
        snapshot = session.snapshot();
    }

    if let Some(cid) = select_page {
        // 切P后先把第一段拉回来，再推状态。
        let (session_id, aid, cookie) = {
            let guard = lock(&inner);
            match guard.as_ref() {
                Some(session) => (
                    session.session_id.clone(),
                    session.aid,
                    session.cookie.clone(),
                ),
                None => return Err("当前没有打开的视频弹幕".to_string()),
            }
        };
        let result = fetch_segment(aid, cid, 1, &cookie).await;
        let mut guard = lock(&inner);
        if let Some(session) = guard.as_mut() {
            if session.session_id == session_id {
                match result {
                    Ok(elems) => {
                        store_segment(session, 1, elems);
                        session.loading.remove(&1);
                    }
                    Err(error) => {
                        session.error = Some(error);
                        session.playing = false;
                    }
                }
                snapshot = session.snapshot();
            }
        }
    }

    let _ = app.emit(EVENT_CHANGED, snapshot.clone());
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::{advance_step, VideoControl};

    #[test]
    fn advance_step_follows_real_elapsed_time() {
        // 修复「时间越跑越慢」：步进必须按真实经过时间算，不能固定按 TICK_MS。
        assert_eq!(advance_step(100.0, 1.0), 100);
        assert_eq!(advance_step(104.5, 1.0), 105);
        assert_eq!(advance_step(100.0, 2.0), 200);
        assert_eq!(advance_step(100.0, 0.5), 50);
        // 休眠恢复 / 卡顿时最多按 2 秒补偿，不会一下跳过一大段。
        assert_eq!(advance_step(60_000.0, 1.0), 2_000);
        assert_eq!(advance_step(-5.0, 1.0), 0);
    }

    #[test]
    fn control_deserializes_frontend_payloads() {
        // 前端发出的形状必须能反序列化，否则命令会静默失败（拖动进度条就是栽在这里）。
        let seek: VideoControl = serde_json::from_str(r#"{"action":"seek","positionMs":12345}"#)
            .expect("seek 需要接受 positionMs");
        match seek {
            VideoControl::Seek { position_ms } => assert_eq!(position_ms, 12345),
            other => panic!("unexpected control: {other:?}"),
        }

        let rate: VideoControl =
            serde_json::from_str(r#"{"action":"setRate","rate":1.5}"#).expect("setRate");
        match rate {
            VideoControl::SetRate { rate } => assert!((rate - 1.5).abs() < f64::EPSILON),
            other => panic!("unexpected control: {other:?}"),
        }

        let page: VideoControl =
            serde_json::from_str(r#"{"action":"selectPage","index":1}"#).expect("selectPage");
        assert!(matches!(page, VideoControl::SelectPage { index: 1 }));

        assert!(matches!(
            serde_json::from_str::<VideoControl>(r#"{"action":"play"}"#).unwrap(),
            VideoControl::Play
        ));
        assert!(matches!(
            serde_json::from_str::<VideoControl>(r#"{"action":"pause"}"#).unwrap(),
            VideoControl::Pause
        ));
        assert!(matches!(
            serde_json::from_str::<VideoControl>(r#"{"action":"setLooping","looping":true}"#)
                .unwrap(),
            VideoControl::SetLooping { looping: true }
        ));
    }
}
