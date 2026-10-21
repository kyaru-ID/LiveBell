use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const APP_CONFIG_FILE: &str = "app-config.json";
pub const LIVE_STATE_UNKNOWN: &str = "unknown";
pub const LIVE_STATE_OFFLINE: &str = "offline";
pub const LIVE_STATE_LIVE: &str = "live";
pub const LIVE_STATE_ERROR: &str = "error";

fn normalize_live_state(value: &str) -> String {
    if matches!(
        value,
        LIVE_STATE_UNKNOWN | LIVE_STATE_OFFLINE | LIVE_STATE_LIVE | LIVE_STATE_ERROR
    ) {
        value.to_string()
    } else {
        LIVE_STATE_UNKNOWN.to_string()
    }
}
const MAX_SELECTED_ROOMS: usize = 5;
const UNGROUPED_SAVED_ROOM_GROUP_ID: &str = "uncategorized";
const DEPRECATED_FILTER_TARGETS: [&str; 4] =
    ["commentText", "messageType", "giftName", "guardLevel"];
static APP_CONFIG_WRITE_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    pub room_id: String,
    pub saved_room_groups: Vec<SavedRoomGroup>,
    pub saved_rooms: Vec<SavedRoom>,
    pub selected_saved_room_ids: Vec<String>,
    pub send: SendConfig,
    pub auth: AuthConfig,
    pub update: UpdateConfig,
    pub recording: RecordingConfig,
    pub appearance: AppearanceConfig,
    pub message_display: MessageDisplayConfig,
    pub filter: FilterConfig,
    pub shortcuts: ShortcutConfig,
    pub notification: NotificationConfig,
    pub mock_panel_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SavedRoomGroup {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRoom {
    pub id: String,
    pub room_id: String,
    pub display_name: String,
    pub anchor_name: Option<String>,
    /// 本地头像文件（Data/Avatars/*.jpg），由后端下载缓存，前端只读。
    pub avatar_path: Option<String>,
    pub group_ids: Vec<String>,
    pub order: i64,
    pub is_enabled: bool,
    pub live_state: String,
    pub live_title: Option<String>,
    /// 本轮开播的开始时间（RFC3339，B 站 live_time 解析；取不到时用本地首次检测时间）。
    /// 只在本轮直播期间有值，转未开播时清空。
    pub live_started_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AuthConfig {
    pub enabled: bool,
    pub last_login_uid: Option<u64>,
    pub last_login_name: Option<String>,
    pub last_validated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UpdateConfig {
    pub check_on_startup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RecordingConfig {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SendConfig {
    pub last_room_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearanceConfig {
    pub font_size: u32,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_ui_theme")]
    pub theme: String,
    pub opacity: f64,
    pub scroll_duration: f64,
    pub density: String,
    pub show_username: bool,
    pub color: String,
    pub message_flow: String,
    pub vertical_overflow_policy: String,
    /// 弹幕表情图片的缩放（0.5–2.0，默认 1.0；对齐 C# 老版 DanmakuEmoteScale）。
    pub emote_scale: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MessageDisplayConfig {
    pub show_danmaku: bool,
    /// 是否显示「抽奖弹幕」（观众为参与天选 / 红包抽奖自动发出的弹幕，B 站会打标记）。
    /// 默认显示；关掉即屏蔽抽奖期间刷屏的那批弹幕。
    #[serde(default = "default_true")]
    pub show_lottery: bool,
    #[serde(default = "default_true")]
    pub show_emotes: bool,
    pub show_gift: bool,
    pub show_guard: bool,
    #[serde(default = "default_true")]
    pub show_super_chat: bool,
    /// 是否在弹幕层右上角显示「同接数」徽章（对齐 C# 老版 DanmakuShowOnlineCount）。
    #[serde(default = "default_true")]
    pub show_online_count: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct FilterConfig {
    pub blocked_words: Vec<String>,
    pub rules: Vec<FilterRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FilterRule {
    pub id: String,
    pub enabled: bool,
    pub name: String,
    pub target: String,
    pub operator: String,
    pub value: String,
    pub action: String,
}

impl Default for FilterRule {
    fn default() -> Self {
        Self {
            id: String::new(),
            enabled: true,
            name: String::new(),
            target: "text".to_string(),
            operator: "contains".to_string(),
            value: String::new(),
            action: "hide".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ShortcutConfig {
    pub toggle_edit_mode: String,
    pub toggle_overlay_window: String,
    pub open_send_danmaku: String,
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            font_size: 20,
            font_family: default_font_family(),
            theme: default_ui_theme(),
            opacity: 0.94,
            scroll_duration: 12.0,
            density: "high".to_string(),
            show_username: false,
            color: "white".to_string(),
            message_flow: "horizontal".to_string(),
            vertical_overflow_policy: "realtime".to_string(),
            emote_scale: 1.0,
        }
    }
}

impl Default for MessageDisplayConfig {
    fn default() -> Self {
        Self {
            show_danmaku: true,
            show_lottery: true,
            show_emotes: true,
            show_gift: true,
            show_guard: true,
            show_super_chat: true,
            show_online_count: true,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_font_family() -> String {
    "system".to_string()
}

fn default_ui_theme() -> String {
    "dark".to_string()
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            // 默认不自动检查：仓库目前是私有的，程序里的更新请求拿不到 release 里的 latest.json。
            check_on_startup: false,
        }
    }
}

impl Default for RecordingConfig {
    fn default() -> Self {
        Self { enabled: false }
    }
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            toggle_edit_mode: shortcut_label().to_string(),
            toggle_overlay_window: overlay_shortcut_label().to_string(),
            open_send_danmaku: send_danmaku_shortcut_label().to_string(),
        }
    }
}

impl Default for SavedRoom {
    fn default() -> Self {
        Self {
            id: String::new(),
            room_id: String::new(),
            display_name: String::new(),
            anchor_name: None,
            avatar_path: None,
            group_ids: Vec::new(),
            order: 0,
            is_enabled: true,
            live_state: LIVE_STATE_UNKNOWN.to_string(),
            live_title: None,
            live_started_at: None,
            last_checked_at: None,
            last_error: None,
            updated_at: String::new(),
        }
    }
}

impl<'de> Deserialize<'de> for SavedRoom {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(default, rename_all = "camelCase")]
        struct SavedRoomWire {
            id: String,
            room_id: String,
            display_name: String,
            anchor_name: Option<String>,
            avatar_path: Option<String>,
            group_ids: Option<Vec<String>>,
            group_id: Option<String>,
            #[serde(rename = "group")]
            legacy_group: Option<String>,
            order: Option<i64>,
            #[serde(default = "default_true")]
            is_enabled: bool,
            live_state: String,
            live_title: Option<String>,
            live_started_at: Option<String>,
            last_checked_at: Option<String>,
            last_error: Option<String>,
            updated_at: String,
        }

        impl Default for SavedRoomWire {
            fn default() -> Self {
                let saved_room = SavedRoom::default();
                Self {
                    id: saved_room.id,
                    room_id: saved_room.room_id,
                    display_name: saved_room.display_name,
                    anchor_name: saved_room.anchor_name,
                    avatar_path: saved_room.avatar_path,
                    group_ids: None,
                    group_id: None,
                    legacy_group: None,
                    order: None,
                    is_enabled: saved_room.is_enabled,
                    live_state: saved_room.live_state,
                    live_title: saved_room.live_title,
                    live_started_at: saved_room.live_started_at,
                    last_checked_at: saved_room.last_checked_at,
                    last_error: saved_room.last_error,
                    updated_at: saved_room.updated_at,
                }
            }
        }

        let wire = SavedRoomWire::deserialize(deserializer)?;
        // 新版是多对多的 groupIds 数组；旧版单个 groupId 或更早的 group 名称都往数组里迁。
        let mut group_ids: Vec<String> = match wire.group_ids {
            Some(group_ids) => group_ids
                .into_iter()
                .map(|group_id| group_id.trim().to_string())
                .filter(|group_id| !group_id.is_empty())
                .collect(),
            None => {
                let legacy_single_group_id = wire.group_id.unwrap_or_default().trim().to_string();
                if !legacy_single_group_id.is_empty() {
                    vec![legacy_single_group_id]
                } else {
                    map_legacy_saved_room_group(wire.legacy_group.as_deref())
                        .map(|group_id| vec![group_id.to_string()])
                        .unwrap_or_default()
                }
            }
        };
        // 未分组的语义是空数组：旧的 "uncategorized" 占位（含 legacy "favorite" 的映射结果）要剔除。
        group_ids.retain(|group_id| group_id != UNGROUPED_SAVED_ROOM_GROUP_ID);

        Ok(Self {
            id: wire.id,
            room_id: wire.room_id,
            display_name: wire.display_name,
            anchor_name: wire.anchor_name,
            avatar_path: wire.avatar_path,
            group_ids,
            order: wire.order.unwrap_or_default(),
            is_enabled: wire.is_enabled,
            live_state: normalize_live_state(&wire.live_state),
            live_title: wire.live_title,
            live_started_at: wire.live_started_at,
            last_checked_at: wire.last_checked_at,
            last_error: wire.last_error,
            updated_at: wire.updated_at,
        })
    }
}

impl Default for SavedRoomGroup {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct NotificationConfig {
    pub monitor_interval_seconds: u32,
    pub notification_duration_seconds: u32,
    pub sound_enabled: bool,
    /// 右下角软件弹窗（对齐 C# 老版 PopupNotificationEnabled）。关掉后仍会写通知记录。
    #[serde(default = "default_true")]
    pub popup_enabled: bool,
    pub windows_toast_enabled: bool,
    pub auto_connect_on_click: bool,
    /// 关注卡片上是否显示「已开播 X」小胶囊。
    #[serde(default = "default_true")]
    pub show_live_duration: bool,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            monitor_interval_seconds: 6,
            notification_duration_seconds: 6,
            sound_enabled: true,
            popup_enabled: true,
            windows_toast_enabled: true,
            auto_connect_on_click: true,
            show_live_duration: true,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            room_id: String::new(),
            saved_room_groups: default_saved_room_groups(),
            saved_rooms: Vec::new(),
            selected_saved_room_ids: Vec::new(),
            send: SendConfig::default(),
            auth: AuthConfig::default(),
            update: UpdateConfig::default(),
            recording: RecordingConfig::default(),
            appearance: AppearanceConfig::default(),
            message_display: MessageDisplayConfig::default(),
            filter: FilterConfig::default(),
            shortcuts: ShortcutConfig::default(),
            notification: NotificationConfig::default(),
            mock_panel_enabled: false,
        }
    }
}

#[tauri::command]
pub fn load_app_config(app: AppHandle) -> Result<AppConfig, String> {
    read_app_config(&app)
}

#[tauri::command]
pub fn save_app_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let config = update_app_config_atomically(&app, move |current, latest| {
        *current = config;
        preserve_authority_owned_sections(current, latest);
    })?;
    tracing::info!(
        target: "livebell::config",
        room_id = %config.room_id,
        font_size = config.appearance.font_size,
        font_family = %config.appearance.font_family,
        opacity = config.appearance.opacity,
        density = %config.appearance.density,
        show_username = config.appearance.show_username,
        "app config saved"
    );
    Ok(config)
}

#[tauri::command]
pub fn set_last_send_room_id(app: AppHandle, room_id: Option<u64>) -> Result<AppConfig, String> {
    update_app_config_atomically(&app, move |config, _| {
        config.send.last_room_id = room_id.map(|value| value.to_string());
    })
}

pub fn read_app_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = app_config_path(app)?;
    let mut config = read_app_config_from_path(&path)?;
    let removed_filter_rule_count = normalize_loaded_app_config(&mut config);
    if removed_filter_rule_count > 0 {
        if let Err(error) = persist_normalized_config_to_path_if_needed(&path) {
            tracing::warn!(
                target: "livebell::config",
                removed_filter_rule_count,
                error = %error,
                "failed to persist deprecated filter rule removal; using normalized in-memory config"
            );
        }
    }
    Ok(config)
}

pub fn update_auth_config(app: &AppHandle, auth: AuthConfig) -> Result<AppConfig, String> {
    update_app_config_atomically(app, move |config, _| {
        config.auth = auth;
    })
}

pub fn update_recording_enabled_config(
    app: &AppHandle,
    enabled: bool,
) -> Result<AppConfig, String> {
    update_app_config_atomically(app, move |config, _| {
        config.recording.enabled = enabled;
    })
}

fn app_config_path(_app: &AppHandle) -> Result<PathBuf, String> {
    crate::portable::data_root().map(|path| path.join(APP_CONFIG_FILE))
}

pub(crate) fn update_app_config_atomically<F>(app: &AppHandle, mutate: F) -> Result<AppConfig, String>
where
    F: FnOnce(&mut AppConfig, &AppConfig),
{
    let path = app_config_path(app)?;
    update_app_config_path_atomically(&path, mutate, |config| {
        app.emit("app-config-changed", config)
            .map_err(|error| error.to_string())
    })
}

fn update_app_config_path_atomically<F, E>(
    path: &Path,
    mutate: F,
    emit: E,
) -> Result<AppConfig, String>
where
    F: FnOnce(&mut AppConfig, &AppConfig),
    E: FnOnce(&AppConfig) -> Result<(), String>,
{
    let _guard = APP_CONFIG_WRITE_GATE
        .lock()
        .map_err(|error| format!("配置写入锁获取失败：{error}"))?;
    let mut config = read_app_config_from_path(path)?;
    let latest = config.clone();
    mutate(&mut config, &latest);
    let _ = normalize_loaded_app_config(&mut config);
    write_app_config_to_path(path, &config)?;
    emit(&config)?;
    Ok(config)
}

fn read_app_config_from_path(path: &Path) -> Result<AppConfig, String> {
    if !path.exists() {
        let mut config = AppConfig::default();
        let _ = normalize_loaded_app_config(&mut config);
        return Ok(config);
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn persist_normalized_config_to_path_if_needed(path: &Path) -> Result<(), String> {
    let _guard = APP_CONFIG_WRITE_GATE
        .lock()
        .map_err(|error| format!("配置写入锁获取失败：{error}"))?;
    if !path.exists() {
        return Ok(());
    }

    let mut config = read_app_config_from_path(path)?;
    if normalize_loaded_app_config(&mut config) == 0 {
        return Ok(());
    }
    write_app_config_to_path(path, &config)
}

fn write_app_config_to_path(path: &Path, config: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn preserve_authority_owned_sections(config: &mut AppConfig, latest: &AppConfig) {
    config.send = latest.send.clone();
    config.auth = latest.auth.clone();
    config.recording = latest.recording.clone();
    // 开播状态与本地头像路径都由后端写入，前端保存配置时不得覆盖。
    for room in &mut config.saved_rooms {
        if let Some(source) = latest.saved_rooms.iter().find(|item| item.id == room.id) {
            room.avatar_path = source.avatar_path.clone();
            room.live_state = source.live_state.clone();
            room.live_title = source.live_title.clone();
            room.last_checked_at = source.last_checked_at.clone();
            room.last_error = source.last_error.clone();
        }
    }
}

fn normalize_loaded_app_config(config: &mut AppConfig) -> usize {
    if config.shortcuts.toggle_edit_mode == legacy_shortcut_label() {
        config.shortcuts.toggle_edit_mode = shortcut_label().to_string();
    }
    if config.shortcuts.toggle_overlay_window.is_empty() {
        config.shortcuts.toggle_overlay_window = overlay_shortcut_label().to_string();
    }
    if config.shortcuts.open_send_danmaku.is_empty() {
        config.shortcuts.open_send_danmaku = send_danmaku_shortcut_label().to_string();
    }
    normalize_app_config(config)
}

fn normalize_app_config(config: &mut AppConfig) -> usize {
    if config.appearance.font_family.trim().is_empty() {
        config.appearance.font_family = default_font_family();
    }

    if !matches!(config.appearance.theme.as_str(), "dark" | "light") {
        config.appearance.theme = default_ui_theme();
    }

    if !matches!(
        config.appearance.message_flow.as_str(),
        "horizontal" | "vertical"
    ) {
        config.appearance.message_flow = "horizontal".to_string();
    }

    if !matches!(
        config.appearance.vertical_overflow_policy.as_str(),
        "realtime" | "complete"
    ) {
        config.appearance.vertical_overflow_policy = "realtime".to_string();
    }

    // 表情缩放：NaN / 越界一律拉回 0.5–2.0，对齐 C# 老版 DanmakuEmoteScale。
    if !config.appearance.emote_scale.is_finite() {
        config.appearance.emote_scale = 1.0;
    }
    config.appearance.emote_scale = config.appearance.emote_scale.clamp(0.5, 2.0);

    normalize_saved_room_groups(&mut config.saved_room_groups);
    let valid_group_ids: HashSet<String> = config
        .saved_room_groups
        .iter()
        .map(|group| group.id.clone())
        .collect();

    for room in &mut config.saved_rooms {
        // 丢掉已不存在的分组并去重；空数组等价于「未分组」。
        let mut seen_group_ids = HashSet::new();
        room.group_ids = room
            .group_ids
            .drain(..)
            .map(|group_id| group_id.trim().to_string())
            .filter(|group_id| {
                valid_group_ids.contains(group_id) && seen_group_ids.insert(group_id.clone())
            })
            .collect();
    }

    let valid_saved_room_ids: HashSet<&str> = config
        .saved_rooms
        .iter()
        .filter(|room| !room.id.trim().is_empty())
        .map(|room| room.id.as_str())
        .collect();
    let mut seen_saved_room_ids = HashSet::new();
    config.selected_saved_room_ids.retain(|id| {
        !id.trim().is_empty()
            && valid_saved_room_ids.contains(id.as_str())
            && seen_saved_room_ids.insert(id.clone())
            && seen_saved_room_ids.len() <= MAX_SELECTED_ROOMS
    });

    if config
        .send
        .last_room_id
        .as_deref()
        .is_some_and(|room_id| !is_positive_room_id(room_id))
    {
        config.send.last_room_id = None;
    }

    config.notification.monitor_interval_seconds =
        config.notification.monitor_interval_seconds.clamp(2, 60);
    config.notification.notification_duration_seconds = config
        .notification
        .notification_duration_seconds
        .clamp(1, 60);

    for room in &mut config.saved_rooms {
        room.live_state = normalize_live_state(&room.live_state);
    }

    let original_rule_count = config.filter.rules.len();
    config
        .filter
        .rules
        .retain(|rule| !DEPRECATED_FILTER_TARGETS.contains(&rule.target.as_str()));
    original_rule_count - config.filter.rules.len()
}

fn is_positive_room_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'1'..=b'9')) && bytes.all(|byte| byte.is_ascii_digit())
}

fn normalize_saved_room_groups(saved_room_groups: &mut Vec<SavedRoomGroup>) {
    for group in saved_room_groups.iter_mut() {
        group.id = group.id.trim().to_string();
        group.name = group.name.trim().to_string();
    }

    saved_room_groups.retain(|group| {
        !group.id.is_empty() && !group.name.is_empty() && group.id != UNGROUPED_SAVED_ROOM_GROUP_ID
    });

    let mut seen_group_ids = HashSet::new();
    saved_room_groups.retain(|group| seen_group_ids.insert(group.id.clone()));

    if saved_room_groups.is_empty() {
        *saved_room_groups = default_saved_room_groups();
    }
}

fn default_saved_room_groups() -> Vec<SavedRoomGroup> {
    [
        ("vtuber", "VTuber"),
        ("game", "游戏"),
        ("chat", "聊天"),
        ("event", "赛事"),
    ]
    .into_iter()
    .map(|(id, name)| SavedRoomGroup {
        id: id.to_string(),
        name: name.to_string(),
        created_at: String::new(),
        updated_at: String::new(),
    })
    .collect()
}

fn map_legacy_saved_room_group(group: Option<&str>) -> Option<&'static str> {
    match group {
        Some("favorite") => Some(UNGROUPED_SAVED_ROOM_GROUP_ID),
        Some("event") => Some("event"),
        Some("study") => Some("chat"),
        Some("entertainment") => Some("game"),
        _ => None,
    }
}

fn shortcut_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Command+Option+K"
    } else {
        "Control+Alt+K"
    }
}

fn overlay_shortcut_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Command+Option+J"
    } else {
        "Control+Alt+J"
    }
}

fn send_danmaku_shortcut_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Command+Option+Enter"
    } else {
        "Control+Alt+Enter"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use tempfile::tempdir;

    fn test_config_path() -> std::path::PathBuf {
        tempdir().expect("tempdir").keep().join(APP_CONFIG_FILE)
    }

    #[test]
    fn old_config_defaults_recording_to_disabled() {
        let config: AppConfig = serde_json::from_value(json!({ "roomId": "6" })).expect("config");

        assert!(!config.recording.enabled);
    }

    #[test]
    fn explicit_recording_enabled_is_preserved() {
        let config: AppConfig = serde_json::from_value(json!({
            "recording": { "enabled": true }
        }))
        .expect("config");

        assert!(config.recording.enabled);
    }

    #[test]
    fn atomic_save_preserves_latest_authority_owned_sections() {
        let path = test_config_path();
        let mut latest = AppConfig::default();
        latest.send.last_room_id = Some("7".to_string());
        latest.auth = AuthConfig {
            enabled: true,
            last_login_uid: Some(42),
            last_login_name: Some("测试账号".to_string()),
            last_validated_at: Some(123),
        };
        latest.recording.enabled = true;
        write_app_config_to_path(&path, &latest).expect("write latest");

        let mut stale = AppConfig::default();
        stale.appearance.theme = "light".to_string();
        stale.room_id = "999".to_string();
        stale.send.last_room_id = Some("1".to_string());
        stale.auth.enabled = false;
        stale.recording.enabled = false;

        let saved = update_app_config_path_atomically(
            &path,
            move |config, current| {
                *config = stale.clone();
                preserve_authority_owned_sections(config, current);
            },
            |_| Ok(()),
        )
        .expect("atomic save");

        assert_eq!(saved.room_id, "999");
        assert_eq!(saved.appearance.theme, "light");
        assert_eq!(saved.send.last_room_id.as_deref(), Some("7"));
        assert!(saved.auth.enabled);
        assert_eq!(saved.auth.last_login_uid, Some(42));
        assert!(saved.recording.enabled);
    }

    #[test]
    fn atomic_updates_serialize_and_keep_latest_changes() {
        let path = Arc::new(test_config_path());
        write_app_config_to_path(path.as_ref(), &AppConfig::default()).expect("write default");

        let barrier = Arc::new(Barrier::new(3));
        let emitted = Arc::new(Mutex::new(Vec::<AppConfig>::new()));

        let send_path = Arc::clone(&path);
        let send_barrier = Arc::clone(&barrier);
        let send_emitted = Arc::clone(&emitted);
        let send_thread = thread::spawn(move || {
            send_barrier.wait();
            update_app_config_path_atomically(
                send_path.as_ref(),
                |config, _| {
                    config.send.last_room_id = Some("6".to_string());
                },
                |config| {
                    send_emitted.lock().expect("emit lock").push(config.clone());
                    Ok(())
                },
            )
            .expect("send update");
        });

        let auth_path = Arc::clone(&path);
        let auth_barrier = Arc::clone(&barrier);
        let auth_emitted = Arc::clone(&emitted);
        let auth_thread = thread::spawn(move || {
            auth_barrier.wait();
            update_app_config_path_atomically(
                auth_path.as_ref(),
                |config, _| {
                    config.auth.enabled = true;
                    config.auth.last_login_uid = Some(99);
                },
                |config| {
                    auth_emitted.lock().expect("emit lock").push(config.clone());
                    Ok(())
                },
            )
            .expect("auth update");
        });

        barrier.wait();
        send_thread.join().expect("send join");
        auth_thread.join().expect("auth join");

        let final_config = read_app_config_from_path(path.as_ref()).expect("read final");
        let emitted = emitted.lock().expect("emit read");

        assert_eq!(emitted.len(), 2);
        assert_eq!(final_config.send.last_room_id.as_deref(), Some("6"));
        assert!(final_config.auth.enabled);
        assert_eq!(final_config.auth.last_login_uid, Some(99));
        assert!(
            emitted.iter().any(|config| {
                config.send.last_room_id.as_deref() == Some("6")
                    && !config.auth.enabled
                    && config.auth.last_login_uid.is_none()
            }) || emitted.iter().any(|config| {
                config.send.last_room_id.is_none()
                    && config.auth.enabled
                    && config.auth.last_login_uid == Some(99)
            })
        );
        assert!(emitted.iter().any(|config| {
            config.send.last_room_id.as_deref() == Some("6")
                && config.auth.enabled
                && config.auth.last_login_uid == Some(99)
        }));
    }

    #[test]
    fn old_config_defaults_multi_room_selection_and_send_target_to_empty() {
        let mut config: AppConfig = serde_json::from_value(json!({
            "savedRooms": [{
                "id": "room-1",
                "roomId": "1",
                "displayName": "房间 1",
                "groupId": "uncategorized",
                "updatedAt": "2026-08-27T00:00:00.000Z"
            }]
        }))
        .expect("config");

        normalize_app_config(&mut config);

        assert!(config.selected_saved_room_ids.is_empty());
        assert!(config.send.last_room_id.is_none());
    }

    #[test]
    fn normalize_multi_room_selection_keeps_five_valid_unique_ids() {
        let mut config: AppConfig = serde_json::from_value(json!({
            "savedRooms": (1..=6).map(|index| json!({
                "id": format!("room-{index}"),
                "roomId": index.to_string(),
                "displayName": format!("房间 {index}"),
                "groupId": "uncategorized",
                "updatedAt": "2026-08-27T00:00:00.000Z"
            })).collect::<Vec<_>>(),
            "selectedSavedRoomIds": [
                "room-1", "room-1", "missing", "room-2",
                "room-3", "room-4", "room-5", "room-6"
            ],
            "send": { "lastRoomId": "123456" }
        }))
        .expect("config");

        normalize_app_config(&mut config);

        assert_eq!(
            config.selected_saved_room_ids,
            vec![
                "room-1".to_string(),
                "room-2".to_string(),
                "room-3".to_string(),
                "room-4".to_string(),
                "room-5".to_string(),
            ]
        );
        assert_eq!(config.send.last_room_id.as_deref(), Some("123456"));
    }

    #[test]
    fn normalize_multi_room_selection_drops_empty_ids_and_keeps_cap_and_dedup() {
        let mut saved_rooms = vec![
            json!({
                "id": "",
                "roomId": "100",
                "displayName": "空 ID",
                "groupId": "uncategorized",
                "updatedAt": "2026-09-05T00:00:00.000Z"
            }),
            json!({
                "id": "   ",
                "roomId": "101",
                "displayName": "空白 ID",
                "groupId": "uncategorized",
                "updatedAt": "2026-09-05T00:00:00.000Z"
            }),
        ];
        saved_rooms.extend((1..=6).map(|index| {
            json!({
                "id": format!("room-{index}"),
                "roomId": index.to_string(),
                "displayName": format!("房间 {index}"),
                "groupId": "uncategorized",
                "updatedAt": "2026-09-05T00:00:00.000Z"
            })
        }));
        let mut config: AppConfig = serde_json::from_value(json!({
            "savedRooms": saved_rooms,
            "selectedSavedRoomIds": [
                "", "   ", "room-1", "room-1", "room-2",
                "room-3", "room-4", "room-5", "room-6"
            ]
        }))
        .expect("config");

        normalize_app_config(&mut config);

        assert_eq!(
            config.selected_saved_room_ids,
            vec![
                "room-1".to_string(),
                "room-2".to_string(),
                "room-3".to_string(),
                "room-4".to_string(),
                "room-5".to_string(),
            ]
        );
    }

    #[test]
    fn normalize_multi_room_selection_drops_invalid_last_send_room_id() {
        for last_room_id in ["", "0", "-1", "1.5", "1e3", "abc"] {
            let mut config: AppConfig = serde_json::from_value(json!({
                "send": { "lastRoomId": last_room_id }
            }))
            .expect("config");

            normalize_app_config(&mut config);

            assert!(config.send.last_room_id.is_none(), "{last_room_id}");
        }
    }

    #[test]
    fn old_message_display_config_defaults_show_emotes_to_true() {
        let config: AppConfig = serde_json::from_value(json!({
            "messageDisplay": {
                "showDanmaku": true,
                "showGift": true,
                "showGuard": true
            }
        }))
        .expect("old config should deserialize");

        assert!(config.message_display.show_emotes);
    }

    #[test]
    fn old_message_display_config_defaults_show_super_chat_to_true() {
        let config: AppConfig = serde_json::from_value(json!({
            "messageDisplay": {
                "showDanmaku": true,
                "showEmotes": true,
                "showGift": true,
                "showGuard": true
            }
        }))
        .expect("old config should deserialize");

        assert!(config.message_display.show_super_chat);
    }

    #[test]
    fn explicit_show_emotes_false_is_preserved() {
        let config: AppConfig = serde_json::from_value(json!({
            "messageDisplay": {
                "showDanmaku": true,
                "showEmotes": false,
                "showGift": true,
                "showGuard": true
            }
        }))
        .expect("config should deserialize");

        assert!(!config.message_display.show_emotes);
    }

    #[test]
    fn explicit_show_super_chat_false_is_preserved() {
        let config: AppConfig = serde_json::from_value(json!({
            "messageDisplay": {
                "showDanmaku": true,
                "showEmotes": true,
                "showGift": true,
                "showGuard": true,
                "showSuperChat": false
            }
        }))
        .expect("config should deserialize");

        assert!(!config.message_display.show_super_chat);
    }

    #[test]
    fn old_appearance_config_defaults_font_family_to_system() {
        let config: AppConfig = serde_json::from_value(json!({
            "appearance": {
                "fontSize": 20,
                "opacity": 0.94,
                "scrollDuration": 12.0,
                "density": "high",
                "showUsername": false,
                "color": "white"
            }
        }))
        .expect("old config should deserialize");

        assert_eq!(config.appearance.font_family, "system");
    }

    #[test]
    fn old_config_defaults_theme_to_dark() {
        let config: AppConfig = serde_json::from_value(json!({
            "appearance": { "fontSize": 20 }
        }))
        .expect("config");

        assert_eq!(config.appearance.theme, "dark");
    }

    #[test]
    fn explicit_light_theme_is_preserved() {
        let config: AppConfig = serde_json::from_value(json!({
            "appearance": { "theme": "light" }
        }))
        .expect("config");

        assert_eq!(config.appearance.theme, "light");
    }

    #[test]
    fn normalize_app_config_resets_invalid_theme_to_dark() {
        let mut config = AppConfig::default();
        config.appearance.theme = "system".to_string();

        normalize_app_config(&mut config);

        assert_eq!(config.appearance.theme, "dark");
    }

    #[test]
    fn old_config_defaults_message_flow_to_horizontal_realtime() {
        let config: AppConfig = serde_json::from_value(json!({
            "appearance": { "fontSize": 20 }
        }))
        .expect("legacy config");

        assert_eq!(config.appearance.message_flow, "horizontal");
        assert_eq!(config.appearance.vertical_overflow_policy, "realtime");
    }

    #[test]
    fn normalize_app_config_resets_invalid_message_flow_values() {
        let mut config = AppConfig::default();
        config.appearance.message_flow = "diagonal".to_string();
        config.appearance.vertical_overflow_policy = "unbounded".to_string();

        normalize_app_config(&mut config);

        assert_eq!(config.appearance.message_flow, "horizontal");
        assert_eq!(config.appearance.vertical_overflow_policy, "realtime");
    }

    #[test]
    fn explicit_vertical_complete_mode_is_preserved() {
        let mut config: AppConfig = serde_json::from_value(json!({
            "appearance": {
                "messageFlow": "vertical",
                "verticalOverflowPolicy": "complete"
            }
        }))
        .expect("vertical config");

        normalize_app_config(&mut config);

        assert_eq!(config.appearance.message_flow, "vertical");
        assert_eq!(config.appearance.vertical_overflow_policy, "complete");
    }

    #[test]
    fn normalize_app_config_resets_empty_font_family_to_system() {
        let mut config = AppConfig::default();
        config.appearance.font_family = "   ".to_string();

        let _ = normalize_app_config(&mut config);

        assert_eq!(config.appearance.font_family, "system");
    }

    #[test]
    fn removes_deprecated_filter_targets_and_keeps_supported_rules() {
        let mut config: AppConfig = serde_json::from_value(json!({
            "filter": { "blockedWords": ["旧词"], "rules": [
                { "id": "text", "target": "text", "operator": "contains", "value": "a", "action": "hide" },
                { "id": "user", "target": "user", "operator": "equals", "value": "A", "action": "hide" },
                { "id": "uid", "target": "senderUid", "operator": "equals", "value": "42", "action": "highlight" },
                { "id": "fan", "target": "currentRoomFanMedal", "operator": "equals", "value": "no", "action": "hide" },
                { "id": "comment", "target": "commentText", "operator": "contains", "value": "b", "action": "hide" },
                { "id": "type", "enabled": false, "target": "messageType", "operator": "equals", "value": "gift", "action": "hide" },
                { "id": "gift", "target": "giftName", "operator": "equals", "value": "花", "action": "highlight" },
                { "id": "guard", "target": "guardLevel", "operator": "equals", "value": "3", "action": "hide" }
            ]}
        }))
        .expect("config");

        assert_eq!(normalize_app_config(&mut config), 4);
        assert_eq!(
            config
                .filter
                .rules
                .iter()
                .map(|rule| rule.id.as_str())
                .collect::<Vec<_>>(),
            vec!["text", "user", "uid", "fan"]
        );
        assert_eq!(config.filter.blocked_words, vec!["旧词"]);
        assert_eq!(normalize_app_config(&mut config), 0);
    }

    #[test]
    fn old_room_collection_config_defaults_to_ungrouped_room() {
        let config: AppConfig = serde_json::from_value(json!({
            "savedRooms": [
                {
                    "id": "room-1",
                    "roomId": "22625025",
                    "displayName": "旧房间",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                }
            ]
        }))
        .expect("old saved room config should deserialize");

        assert_eq!(config.saved_room_groups.len(), 4);
        assert_eq!(config.saved_room_groups[0].id, "vtuber");
        assert!(config.saved_rooms[0].group_ids.is_empty());
    }

    #[test]
    fn old_connection_history_field_is_ignored() {
        let mut value = json!({
            "savedRooms": [],
        });
        value.as_object_mut().unwrap().insert(
            ["recent", "Rooms"].concat(),
            json!([
                {
                    "id": "old-room-history",
                    "roomId": "22625025",
                    "displayName": "旧连接记录",
                    "connectedAt": "2026-06-06T00:00:00.000Z"
                }
            ]),
        );

        let config: AppConfig =
            serde_json::from_value(value).expect("old connection history field should be ignored");

        assert!(config.saved_rooms.is_empty());
        assert_eq!(config.saved_room_groups[0].id, "vtuber");
    }

    #[test]
    fn legacy_saved_room_group_is_mapped_to_group_id() {
        let config: AppConfig = serde_json::from_value(json!({
            "savedRooms": [
                {
                    "id": "favorite-room",
                    "roomId": "1000",
                    "displayName": "常看旧房间",
                    "group": "favorite",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                },
                {
                    "id": "event-room",
                    "roomId": "1001",
                    "displayName": "活动旧房间",
                    "group": "event",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                },
                {
                    "id": "study-room",
                    "roomId": "1002",
                    "displayName": "学习旧房间",
                    "group": "study",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                },
                {
                    "id": "entertainment-room",
                    "roomId": "1003",
                    "displayName": "娱乐旧房间",
                    "group": "entertainment",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                }
            ]
        }))
        .expect("legacy saved room groups should deserialize");

        let group_ids: Vec<Vec<&str>> = config
            .saved_rooms
            .iter()
            .map(|room| room.group_ids.iter().map(String::as_str).collect())
            .collect();

        assert_eq!(
            group_ids,
            vec![vec![], vec!["event"], vec!["chat"], vec!["game"]]
        );
    }

    #[test]
    fn normalize_app_config_rebuilds_empty_groups_and_marks_invalid_room_ungrouped() {
        let mut config: AppConfig = serde_json::from_value(json!({
            "savedRoomGroups": [],
            "savedRooms": [
                {
                    "id": "room-1",
                    "roomId": "22625025",
                    "displayName": "无效分组房间",
                    "groupId": "missing-group",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                }
            ]
        }))
        .expect("config with invalid group should deserialize");

        let _ = normalize_app_config(&mut config);

        assert_eq!(config.saved_room_groups.len(), 4);
        assert!(config.saved_rooms[0].group_ids.is_empty());
    }

    #[test]
    fn old_default_uncategorized_group_is_removed() {
        let mut config: AppConfig = serde_json::from_value(json!({
            "savedRoomGroups": [
                {
                    "id": "uncategorized",
                    "name": "未分类",
                    "createdAt": "2026-06-06T00:00:00.000Z",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                },
                {
                    "id": "game",
                    "name": "游戏",
                    "createdAt": "2026-06-06T00:00:00.000Z",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                }
            ],
            "savedRooms": [
                {
                    "id": "room-1",
                    "roomId": "22625025",
                    "displayName": "旧未分类房间",
                    "groupId": "uncategorized",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                }
            ]
        }))
        .expect("old default group config should deserialize");

        let _ = normalize_app_config(&mut config);

        assert_eq!(config.saved_room_groups.len(), 1);
        assert_eq!(config.saved_room_groups[0].id, "game");
        assert!(config.saved_rooms[0].group_ids.is_empty());
    }

    #[test]
    fn deprecated_live_status_field_is_ignored_but_last_checked_at_is_parsed() {
        let mut config: AppConfig = serde_json::from_value(json!({
            "savedRooms": [
                {
                    "id": "room-1",
                    "roomId": "22625025",
                    "displayName": "旧状态字段房间",
                    "liveStatus": "live",
                    "lastCheckedAt": "2026-06-06T00:00:00.000Z",
                    "updatedAt": "2026-06-06T00:00:00.000Z"
                }
            ]
        }))
        .expect("deprecated saved room status fields should be ignored");

        let _ = normalize_app_config(&mut config);

        let saved_room =
            serde_json::to_value(&config.saved_rooms[0]).expect("saved room should serialize");

        assert!(config.saved_rooms[0].group_ids.is_empty());
        assert!(saved_room.get("liveStatus").is_none());
        // lastCheckedAt 自阶段3 起是真实字段，输入里会给进来就必须原样保留。
        assert_eq!(
            saved_room.get("lastCheckedAt"),
            Some(&serde_json::Value::String(
                "2026-06-06T00:00:00.000Z".to_string()
            ))
        );
    }
}

fn legacy_shortcut_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Command+Option+D"
    } else {
        "Control+Alt+D"
    }
}
