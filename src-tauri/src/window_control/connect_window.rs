//! 「连接房间」独立窗口：托盘菜单唤起，输房间号或链接直接连弹幕，
//! 不写进关注列表（与 C# Views/ConnectRoomDialog 的语义一致）。

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const CONNECT_WINDOW_LABEL: &str = "connect";
const CONNECT_WINDOW_WIDTH: f64 = 520.0;
const CONNECT_WINDOW_HEIGHT: f64 = 268.0;

// 必须是 async：同步命令在主线程执行，而建窗/显示窗口需要主线程继续跑事件循环，
// 两者互相等待会死锁（阶段3 的 notifications_test 踩过同一个坑）。
pub async fn open_connect_room_window(app: AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(CONNECT_WINDOW_LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            &app,
            CONNECT_WINDOW_LABEL,
            WebviewUrl::App("index.html".into()),
        )
        .title("连接房间")
        .inner_size(CONNECT_WINDOW_WIDTH, CONNECT_WINDOW_HEIGHT)
        .resizable(false)
        .always_on_top(true)
        .center()
        .build()
        .map_err(|error| error.to_string())?,
    };

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    app.emit_to(CONNECT_WINDOW_LABEL, "connect-window-opened", ())
        .map_err(|error| error.to_string())?;
    tracing::info!(target: "livebell::window", "connect room window opened");
    Ok(())
}

pub fn hide_connect_room_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(CONNECT_WINDOW_LABEL)
        .ok_or_else(|| "connect window not found".to_string())?;
    window.hide().map_err(|error| error.to_string())?;
    tracing::info!(target: "livebell::window", "connect room window hidden");
    Ok(())
}
