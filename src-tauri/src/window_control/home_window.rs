//! 主界面窗口（label home）：照 C# 老版 MainWindow 的关注列表 + 分组页签 + 状态栏。
//! 弹幕悬浮层 main、设置窗 control 的职责保持不变。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex;

pub const HOME_WINDOW_LABEL: &str = "home";
const HOME_WINDOW_WIDTH: f64 = 980.0;
const HOME_WINDOW_HEIGHT: f64 = 660.0;
const HOME_WINDOW_MIN_WIDTH: f64 = 800.0;
const HOME_WINDOW_MIN_HEIGHT: f64 = 520.0;

// 建窗是「查 label → build → 注册进窗口表」三步，Tauri 只在 build 开始时查一次重复
// label（prepare_webview），注册却在 build 末尾，两步并不原子。并发调用（托盘双击会同时
// 触发两次）会各自建出一个 HWND，多出来的那个不在窗口表里，屏幕上就叠出两个主界面。
// 用锁把整个开窗流程串行化：第二个调用拿锁时窗口已经注册，只会走 show 分支。
static OPEN_LOCK: Mutex<()> = Mutex::const_new(());

// 必须是 async：同步命令在主线程执行，而建窗/显示窗口需要主线程继续跑事件循环，
// 两者互相等待会死锁（阶段3 的 notifications_test 与 4c 的 connect_window 都踩过）。
pub async fn open_home_window(app: AppHandle) -> Result<(), String> {
    let _open_guard = OPEN_LOCK.lock().await;
    let window = match app.get_webview_window(HOME_WINDOW_LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            &app,
            HOME_WINDOW_LABEL,
            WebviewUrl::App("index.html".into()),
        )
        .title("LiveBell")
        .inner_size(HOME_WINDOW_WIDTH, HOME_WINDOW_HEIGHT)
        .min_inner_size(HOME_WINDOW_MIN_WIDTH, HOME_WINDOW_MIN_HEIGHT)
        .center()
        // Tauri 默认在 Windows 上给 webview 注册 OLE drop target（为了 onDragDropEvent 的文件拖放），
        // 它会顶掉 WebView2 自己的拖放目标，导致关注卡片上的 HTML5 draggable 完全不触发。
        // 这里没有用到文件拖入，关掉原生的拖放处理器，页面内拖拽才能生效。
        .disable_drag_drop_handler()
        .build()
        .map_err(|error| error.to_string())?,
    };

    // 恢复上次调整过的大小与位置（老版 Data 目录里的 window-layout.json）。
    if let Some(layout) = super::layout::home_window_layout(&app) {
        super::layout::restore_window_layout_for_label(&app, HOME_WINDOW_LABEL, &layout);
    }

    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|error| error.to_string())?;
    tracing::info!(target: "livebell::window", "home window opened");
    Ok(())
}

pub fn hide_home_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(HOME_WINDOW_LABEL)
        .ok_or_else(|| "home window not found".to_string())?;
    window.hide().map_err(|error| error.to_string())?;
    tracing::info!(target: "livebell::window", "home window hidden");
    Ok(())
}
