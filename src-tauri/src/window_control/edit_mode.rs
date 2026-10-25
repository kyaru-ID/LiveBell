use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::{layout, state::EditModeState};

#[derive(Debug, Clone, Serialize)]
pub struct EditModeChanged {
    pub is_edit_mode: bool,
    pub is_click_through: bool,
    pub shortcut: String,
}

pub fn set_edit_mode(
    app: AppHandle,
    state: State<'_, EditModeState>,
    enabled: bool,
) -> Result<EditModeChanged, String> {
    apply_edit_mode(&app, &state, enabled)
}

pub fn toggle_edit_mode(
    app: &AppHandle,
    state: &State<'_, EditModeState>,
) -> Result<EditModeChanged, String> {
    let next_enabled = {
        let enabled = state.enabled.lock().map_err(|error| error.to_string())?;
        !*enabled
    };
    apply_edit_mode(app, state, next_enabled)
}

fn apply_edit_mode(
    app: &AppHandle,
    state: &State<'_, EditModeState>,
    enabled: bool,
) -> Result<EditModeChanged, String> {
    let was_enabled = {
        let mut current = state.enabled.lock().map_err(|error| error.to_string())?;
        let was_enabled = *current;
        *current = enabled;
        was_enabled
    };

    if enabled {
        show_overlay_window(app)?;
    }
    set_click_through(app, !enabled)?;

    if was_enabled && !enabled {
        if let Err(error) = layout::save_window_layout(app.clone()) {
            tracing::warn!(
                target: "livebell::window",
                error = %error,
                "failed to save window layout when exiting edit mode"
            );
        }
    }

    let payload = current_edit_mode_payload(state)?;

    app.emit("edit-mode-changed", &payload)
        .map_err(|error| error.to_string())?;

    tracing::info!(
        target: "livebell::window",
        is_edit_mode = payload.is_edit_mode,
        is_click_through = payload.is_click_through,
        "edit mode changed"
    );
    Ok(payload)
}

pub(super) fn current_edit_mode_payload(
    state: &State<'_, EditModeState>,
) -> Result<EditModeChanged, String> {
    let is_edit_mode = *state.enabled.lock().map_err(|error| error.to_string())?;
    let shortcut = state
        .shortcut
        .lock()
        .map_err(|error| error.to_string())?
        .label
        .clone();

    Ok(EditModeChanged {
        is_edit_mode,
        is_click_through: !is_edit_mode,
        shortcut,
    })
}

/// 按当前编辑模式重新应用鼠标穿透。
/// Tauri 的 ignore_cursor_events 只是窗口样式，而窗口每次 show() 出来时默认是「可交互」的：
/// 不重新应用的话，从「连上直播间」或托盘显示出来的弹幕层会把整片区域都拦住，
/// 下面的直播页面就点不动了（用户报的严重 bug）。
pub fn sync_click_through(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<EditModeState>();
    let is_edit_mode = *state.enabled.lock().map_err(|error| error.to_string())?;
    set_click_through(app, !is_edit_mode)
}


pub fn set_click_through(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    window
        .set_ignore_cursor_events(enabled)
        .map_err(|error| error.to_string())
}

pub(super) fn toggle_overlay_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let is_visible = window.is_visible().map_err(|error| error.to_string())?;

    if is_visible {
        window.hide().map_err(|error| error.to_string())?;
        tracing::info!(target: "livebell::window", "overlay window hidden from shortcut");
    } else {
        window.show().map_err(|error| error.to_string())?;
        // 显示后重新应用穿透：快捷键唤出的弹幕层在非编辑模式下同样必须穿透。
        sync_click_through(app)?;
        tracing::info!(target: "livebell::window", "overlay window shown from shortcut");
    }

    Ok(())
}

fn show_overlay_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    if !window.is_visible().map_err(|error| error.to_string())? {
        window.show().map_err(|error| error.to_string())?;
        tracing::info!(target: "livebell::window", "overlay window shown when entering edit mode");
    }
    Ok(())
}
