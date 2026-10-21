//! 「主播信息」独立窗口：主界面的「＋ 添加主播」与行内「••• 编辑」都用它，
//! 对齐 C# Views/StreamerDialog.xaml（500x520、窗口内搜索主播名/房间号 + 选分组）。

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::home_window::HOME_WINDOW_LABEL;

pub const STREAMER_WINDOW_LABEL: &str = "streamer";
const STREAMER_WINDOW_WIDTH: f64 = 520.0;
const STREAMER_WINDOW_HEIGHT: f64 = 560.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamerDialogOpened {
    /// None 表示新增；Some(id) 表示编辑关注列表里的哪一条。
    saved_room_id: Option<String>,
}

/// 窗口刚建好时前端还没挂载，`streamer-dialog-opened` 事件会丢；
/// 这里同时存一份待处理目标，前端挂载后主动 take 一次。
#[derive(Default)]
pub struct StreamerDialogTarget(Mutex<Option<String>>);

/// 读当前目标：None=新增，Some(id)=编辑。
/// 故意只读不清空：React StrictMode 下 effect 会跑两遍，若第一遍把值取走，
/// 第二遍就会拿到 None 并把已填好的编辑态清空（这个坑实测踩过）。
/// 每次 open 都会整体覆盖，所以不会残留上一次的目标。
/// 由 window_control::mod 包成 tauri 命令（跨模块定义命令宏会重名）。
pub fn streamer_dialog_target(state: State<'_, StreamerDialogTarget>) -> Option<String> {
    state.0.lock().map(|target| target.clone()).unwrap_or(None)
}

// 必须是 async：同步命令在主线程执行，而建窗/显示窗口需要主线程继续跑事件循环，
// 两者互相等待会死锁（阶段3 的 notifications_test 踩过同一个坑）。
pub async fn open_streamer_dialog_window(
    app: AppHandle,
    saved_room_id: Option<String>,
) -> Result<(), String> {
    let window = match app.get_webview_window(STREAMER_WINDOW_LABEL) {
        Some(window) => window,
        None => {
            let builder = WebviewWindowBuilder::new(
                &app,
                STREAMER_WINDOW_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title("主播信息")
            .inner_size(STREAMER_WINDOW_WIDTH, STREAMER_WINDOW_HEIGHT)
            .resizable(false)
            .center();
            // 不用 always_on_top：那会让对话框盖住别的应用窗口（C# 版 V1.4.1 已改成
            // Owner 关联主窗口，只压在 LiveBell 自己的窗口之上）。
            let builder = match app.get_webview_window(HOME_WINDOW_LABEL) {
                Some(home) => builder.parent(&home).map_err(|error| error.to_string())?,
                None => builder,
            };
            builder.build().map_err(|error| error.to_string())?
        }
    };

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    if let Some(state) = app.try_state::<StreamerDialogTarget>() {
        if let Ok(mut target) = state.0.lock() {
            *target = saved_room_id.clone();
        }
    }
    app.emit_to(
        STREAMER_WINDOW_LABEL,
        "streamer-dialog-opened",
        StreamerDialogOpened { saved_room_id },
    )
    .map_err(|error| error.to_string())?;
    tracing::info!(target: "livebell::window", "streamer dialog window opened");
    Ok(())
}

pub fn hide_streamer_dialog_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(STREAMER_WINDOW_LABEL)
        .ok_or_else(|| "streamer window not found".to_string())?;
    window.hide().map_err(|error| error.to_string())?;
    tracing::info!(target: "livebell::window", "streamer dialog window hidden");
    Ok(())
}
