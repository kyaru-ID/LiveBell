use std::time::Duration;

use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Runtime, Window,
};

use crate::window_control::{self, EditModeState};

const MENU_SHOW_HOME: &str = "show_home";
const MENU_SHOW_OVERLAY: &str = "show_overlay";
const MENU_HIDE_OVERLAY: &str = "hide_overlay";
const MENU_TOGGLE_EDIT_MODE: &str = "toggle_edit_mode";
const MENU_SHOW_CONTROL: &str = "show_control";
const MENU_SEND_DANMAKU: &str = "send_danmaku";
const MENU_CONNECT_ROOM: &str = "connect_room";
const MENU_EXIT: &str = "exit";
/// 托盘图标：显式从嵌入的 PNG 解码，不依赖 `app.default_window_icon()`。
/// 后者在 bundle 图标解析失败时会返回 None，导致托盘出现一个看不见的空白图标。
///
/// 用专用图而不是 `icons/32x32.png`：后者是 exe/窗口图标，带深色方块底；托盘要的是
/// 透明底 + 浅青（#62d7e4）的铃形，这样在任务栏上不会是一块黑方块，也不受应用内主题影响
/// （Windows 托盘没有 macOS 那种 template image 自动反色）。
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray.png");
/// 托盘图标 id：重建（真的重发 NIM_ADD）时要按它摘掉旧图标。
const TRAY_ID: &str = "livebell";

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let tray = build_tray(app.handle())?;
    tracing::info!(target: "livebell::tray", "tray initialized");
    verify_tray_registered(app.handle().clone(), tray);
    Ok(())
}

/// 构建托盘图标。
///
/// 抽成函数是为了能在 verify_tray_registered 里真的**重新发一次** NIM_ADD：
/// 只调 set_visible 只是给窗口发消息，不会重发 NIM_ADD，注册失败时救不回来。
fn build_tray(app: &AppHandle) -> tauri::Result<tauri::tray::TrayIcon<tauri::Wry>> {
    let menu = MenuBuilder::new(app)
        .text(MENU_SHOW_HOME, "打开 LiveBell")
        .text(MENU_SHOW_OVERLAY, "显示弹幕窗口")
        .text(MENU_HIDE_OVERLAY, "隐藏弹幕窗口")
        .text(MENU_TOGGLE_EDIT_MODE, "切换模式")
        .text(MENU_SHOW_CONTROL, "显示设置")
        .text(MENU_SEND_DANMAKU, "发送弹幕")
        .text(MENU_CONNECT_ROOM, "连接房间…")
        .separator()
        .text(MENU_EXIT, "退出 LiveBell")
        .build()?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("LiveBell")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(move |tray, event| match event {
            // 左键单击打开主界面。这里只认抬起事件：Windows 上一次双击就是两次
            // WM_LBUTTONUP 中间夹一个 WM_LBUTTONDBLCLK，单击分支已经覆盖了双击的每一次
            // 抬起，再单独处理 DoubleClick 只会让一次双击触发多次开窗。
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                open_home_window_async(tray.app_handle());
            }
            _ => {}
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW_HOME => {
                open_home_window_async(app);
            }
            MENU_SHOW_OVERLAY => {
                let _ = show_window_by_label(app, "main");
            }
            MENU_HIDE_OVERLAY => {
                let _ = hide_window_by_label(app, "main");
            }
            MENU_TOGGLE_EDIT_MODE => {
                let state = app.state::<EditModeState>();
                let _ = window_control::toggle_edit_mode(app, &state);
            }
            MENU_SHOW_CONTROL => {
                let _ = show_window_by_label(app, "control");
            }
            MENU_SEND_DANMAKU => {
                // 建窗是 async 的，托盘回调跑在主线程上，这里必须丢到异步运行时去建窗。
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = window_control::open_send_danmaku_window(handle).await {
                        tracing::warn!(target: "livebell::tray", error = %error, "failed to open send danmaku window");
                    }
                });
            }
            MENU_CONNECT_ROOM => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = window_control::open_connect_room_window(handle).await {
                        tracing::warn!(target: "livebell::tray", error = %error, "failed to open connect room window");
                    }
                });
            }
            MENU_EXIT => {
                app.exit(0);
            }
            _ => {}
        });

    match tauri::image::Image::from_bytes(TRAY_ICON_PNG) {
        Ok(icon) => {
            tracing::info!(
                target: "livebell::tray",
                width = icon.width(),
                height = icon.height(),
                "tray icon loaded from embedded png"
            );
            builder = builder.icon(icon);
        }
        Err(error) => {
            tracing::warn!(
                target: "livebell::tray",
                error = %error,
                "failed to decode embedded tray icon, falling back to default window icon"
            );
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
        }
    }

    builder.build(app)
}

/// tray-icon 在 `Shell_NotifyIconW(NIM_ADD)` 失败时是**静默**的：它只保留隐藏窗口等
/// `TaskbarCreated` 重注册，`build()` 照样返回 Ok，日志也照打 initialized。
/// 所以这里主动查一次图标是否真的进了任务栏（`rect()` 内部走 `Shell_NotifyIconGetRect`），
/// 没进就**真的重建一次**（摘掉旧的再 build，重发 NIM_ADD；只调 `set_visible` 是发窗口消息，
/// 不会重发 NIM_ADD）。全部失败后再跑一次原生探针，把 NIM_ADD 的真实返回值写进日志。
fn verify_tray_registered(app: AppHandle, mut tray: tauri::tray::TrayIcon<tauri::Wry>) {
    tauri::async_runtime::spawn(async move {
        for attempt in 1..=5u32 {
            if attempt > 1 {
                tokio::time::sleep(Duration::from_millis(800)).await;
            }
            match tray.rect() {
                Ok(Some(_)) => {
                    tracing::info!(target: "livebell::tray", attempt, "tray icon present in taskbar");
                    return;
                }
                Ok(None) => {
                    tracing::warn!(
                        target: "livebell::tray",
                        attempt,
                        "tray icon missing from taskbar, rebuilding"
                    );
                    let _ = app.remove_tray_by_id(TRAY_ID);
                    match build_tray(&app) {
                        Ok(next) => tray = next,
                        Err(error) => {
                            tracing::warn!(target: "livebell::tray", error = %error, "failed to rebuild tray icon");
                            break;
                        }
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        target: "livebell::tray",
                        attempt,
                        error = %error,
                        "tray icon rect query failed"
                    );
                }
            }
        }
        tracing::warn!(target: "livebell::tray", "tray icon still missing from taskbar after retries");
        probe_notify_icon(&app);
    });
}

/// 原生探针（诊断用）：在消息循环已经跑起来之后，自己直接调一次
/// `Shell_NotifyIconW(NIM_ADD)`，把返回值、`GetLastError` 以及随后
/// `Shell_NotifyIconGetRect` 的结果写进日志。
/// 用来区分「注册时机太早」与「注册本身被拒」。
fn probe_notify_icon(app: &AppHandle) {
    use windows::Win32::Foundation::{GetLastError, HWND};
    use windows::Win32::UI::Shell::{
        Shell_NotifyIconGetRect, Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_SHOWTIP, NIF_TIP,
        NIM_ADD, NIM_DELETE, NOTIFYICONDATAW, NOTIFYICONIDENTIFIER,
    };
    use windows::Win32::UI::WindowsAndMessaging::{LoadIconW, IDI_APPLICATION, WM_APP};

    let Some(window) = app
        .get_webview_window("control")
        .or_else(|| app.get_webview_window("main"))
    else {
        tracing::warn!(target: "livebell::tray", "tray probe skipped: no window to attach to");
        return;
    };
    let Ok(raw) = window.hwnd() else {
        tracing::warn!(target: "livebell::tray", "tray probe skipped: window has no hwnd");
        return;
    };
    let hwnd_value = raw.0 as isize;
    let result = app.run_on_main_thread(move || unsafe {
        let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
        let mut nid: NOTIFYICONDATAW = std::mem::zeroed();
        nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        nid.hWnd = hwnd;
        nid.uID = 77;
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP;
        nid.uCallbackMessage = WM_APP + 77;
        nid.hIcon = LoadIconW(None, IDI_APPLICATION).unwrap_or_default();
        let tip: Vec<u16> = "livebell probe\0".encode_utf16().collect();
        let len = tip.len().min(nid.szTip.len());
        nid.szTip[..len].copy_from_slice(&tip[..len]);
        let added = Shell_NotifyIconW(NIM_ADD, &mut nid);
        let error = GetLastError();
        tracing::info!(target: "livebell::tray", added = added.as_bool(), error = error.0, "tray probe NIM_ADD result");
        std::thread::sleep(Duration::from_millis(600));
        let mut identifier: NOTIFYICONIDENTIFIER = std::mem::zeroed();
        identifier.cbSize = std::mem::size_of::<NOTIFYICONIDENTIFIER>() as u32;
        identifier.hWnd = hwnd;
        identifier.uID = 77;
        match Shell_NotifyIconGetRect(&identifier) {
            Ok(rect) => tracing::info!(target: "livebell::tray", left = rect.left, top = rect.top, "tray probe GetRect result"),
            Err(error) => tracing::info!(target: "livebell::tray", error = %error, "tray probe GetRect failed"),
        }
        if added.as_bool() {
            let _ = Shell_NotifyIconW(NIM_DELETE, &mut nid);
        }
    });
    if let Err(error) = result {
        tracing::warn!(target: "livebell::tray", error = %error, "failed to run tray probe on main thread");
    }
}

pub fn prevent_close_to_tray<R: Runtime>(window: &Window<R>, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
        tracing::info!(
            target: "livebell::tray",
            label = window.label(),
            "window close intercepted and hidden to tray"
        );
    }
}

#[tauri::command]
pub fn show_window(app: AppHandle, label: String) -> Result<(), String> {
    show_window_by_label(&app, &label)
}

#[tauri::command]
pub fn hide_window(app: AppHandle, label: String) -> Result<(), String> {
    hide_window_by_label(&app, &label)
}

/// 主界面是运行时创建的，建窗必须在异步运行时里做（托盘回调跑在主线程上）。
fn open_home_window_async(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = window_control::open_home_window(handle).await {
            tracing::warn!(target: "livebell::tray", error = %error, "failed to open home window");
        }
    });
}

fn show_window_by_label(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window not found: {}", label))?;
    window.show().map_err(|error| error.to_string())?;
    // 弹幕层显示后按当前编辑模式重新应用穿透，否则托盘唤出的弹幕层会拦住鼠标点击。
    if label == "main" {
        crate::window_control::sync_click_through(app)?;
    }
    window.set_focus().map_err(|error| error.to_string())
}

fn hide_window_by_label(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window not found: {}", label))?;
    window.hide().map_err(|error| error.to_string())
}
