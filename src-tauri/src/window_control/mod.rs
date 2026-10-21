mod connect_window;
mod edit_mode;
mod home_window;
mod layout;
mod send_window;
mod shortcuts;
mod streamer_window;
mod state;

pub use edit_mode::EditModeChanged;
pub use layout::WindowLayout;
pub use shortcuts::ShortcutChanged;
pub use state::EditModeState;
pub use streamer_window::StreamerDialogTarget;

use tauri::{App, AppHandle, State};

use crate::app_config;

#[tauri::command]
pub fn set_edit_mode(
    app: AppHandle,
    state: State<'_, EditModeState>,
    enabled: bool,
) -> Result<EditModeChanged, String> {
    edit_mode::set_edit_mode(app, state, enabled)
}

pub fn toggle_edit_mode(
    app: &AppHandle,
    state: &State<'_, EditModeState>,
) -> Result<EditModeChanged, String> {
    edit_mode::toggle_edit_mode(app, state)
}

pub fn set_click_through(app: &AppHandle, enabled: bool) -> Result<(), String> {
    edit_mode::set_click_through(app, enabled)
}

/// 窗口显示之后重新按当前编辑模式同步鼠标穿透（见 edit_mode::sync_click_through）。
pub fn sync_click_through(app: &AppHandle) -> Result<(), String> {
    edit_mode::sync_click_through(app)
}

#[tauri::command]
pub fn set_edit_mode_shortcut(
    app: AppHandle,
    state: State<'_, EditModeState>,
    shortcut: String,
) -> Result<EditModeChanged, String> {
    shortcuts::set_edit_mode_shortcut(app, state, shortcut)
}

#[tauri::command]
pub fn set_overlay_window_shortcut(
    app: AppHandle,
    state: State<'_, EditModeState>,
    shortcut: String,
) -> Result<ShortcutChanged, String> {
    shortcuts::set_overlay_window_shortcut(app, state, shortcut)
}

#[tauri::command]
pub fn set_send_danmaku_shortcut(
    app: AppHandle,
    state: State<'_, EditModeState>,
    shortcut: String,
) -> Result<ShortcutChanged, String> {
    shortcuts::set_send_danmaku_shortcut(app, state, shortcut)
}

// 建窗命令必须是 async，否则同步命令占住主线程后建窗会死锁。
#[tauri::command]
pub async fn open_send_danmaku_window(app: AppHandle) -> Result<(), String> {
    send_window::open_send_danmaku_window(app)
}

#[tauri::command]
pub fn hide_send_danmaku_window(app: AppHandle) -> Result<(), String> {
    send_window::hide_send_danmaku_window(app)
}

// 建窗命令必须是 async，否则同步命令占住主线程后建窗会死锁。
#[tauri::command]
pub async fn open_connect_room_window(app: AppHandle) -> Result<(), String> {
    connect_window::open_connect_room_window(app).await
}

#[tauri::command]
pub fn hide_connect_room_window(app: AppHandle) -> Result<(), String> {
    connect_window::hide_connect_room_window(app)
}

// 建窗命令必须是 async，否则同步命令占住主线程后建窗会死锁。
#[tauri::command]
pub async fn open_streamer_dialog_window(
    app: AppHandle,
    saved_room_id: Option<String>,
) -> Result<(), String> {
    streamer_window::open_streamer_dialog_window(app, saved_room_id).await
}

#[tauri::command]
pub fn hide_streamer_dialog_window(app: AppHandle) -> Result<(), String> {
    streamer_window::hide_streamer_dialog_window(app)
}

#[tauri::command]
pub fn streamer_dialog_target(
    state: State<'_, StreamerDialogTarget>,
) -> Option<String> {
    streamer_window::streamer_dialog_target(state)
}

// 建窗命令必须是 async，否则同步命令占住主线程后建窗会死锁。
#[tauri::command]
pub async fn open_home_window(app: AppHandle) -> Result<(), String> {
    home_window::open_home_window(app).await
}

#[tauri::command]
pub fn hide_home_window(app: AppHandle) -> Result<(), String> {
    home_window::hide_home_window(app)
}

#[tauri::command]
pub fn begin_send_danmaku_window_drag(
    app: AppHandle,
    state: State<'_, EditModeState>,
    screen_x: f64,
    screen_y: f64,
) -> Result<(), String> {
    send_window::begin_send_danmaku_window_drag(app, state, screen_x, screen_y)
}

#[tauri::command]
pub fn drag_send_danmaku_window(
    app: AppHandle,
    state: State<'_, EditModeState>,
    screen_x: f64,
    screen_y: f64,
) -> Result<(), String> {
    send_window::drag_send_danmaku_window(app, state, screen_x, screen_y)
}

#[tauri::command]
pub fn end_send_danmaku_window_drag(state: State<'_, EditModeState>) -> Result<(), String> {
    send_window::end_send_danmaku_window_drag(state)
}

#[tauri::command]
pub fn save_window_layout(app: AppHandle) -> Result<WindowLayout, String> {
    layout::save_window_layout(app)
}

#[tauri::command]
pub fn load_window_layout(app: AppHandle) -> Result<Option<WindowLayout>, String> {
    layout::load_window_layout(app)
}

/// 窗口事件入口：可见时按 label 防抖后再保存布局，隐藏/最小化时的 Resized 直接忽略。
pub fn schedule_window_layout_save(app: &AppHandle, label: &str) {
    layout::schedule_window_layout_save(app, label)
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    layout::restore_window_layout(app.handle());
    // 弹幕层默认鼠标穿透，只有编辑模式才接收鼠标。窗口刚建出来时 Tauri 默认是可交互的，
    // 这里先同步一次；连上直播间后 ws.rs 显示窗口时还会再同步一次。
    if let Err(error) = sync_click_through(app.handle()) {
        tracing::warn!(
            target: "livebell::window",
            error = %error,
            "failed to apply initial click-through to overlay window"
        );
    }
    let configured_shortcuts = app_config::read_app_config(app.handle())
        .map(|config| config.shortcuts)
        .unwrap_or_else(|error| {
            tracing::warn!(
                target: "livebell::window",
                error = %error,
                "failed to read shortcuts from app config; using default shortcuts"
            );
            app_config::ShortcutConfig::default()
        });
    shortcuts::register_global_shortcuts(app, &configured_shortcuts)?;
    Ok(())
}
