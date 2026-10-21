use std::collections::HashMap;
use std::fs;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size};

const WINDOW_LAYOUT_FILE: &str = "window-layout.json";
const MIN_WINDOW_WIDTH: u32 = 320;
const MIN_WINDOW_HEIGHT: u32 = 160;
const CONTROL_MIN_WINDOW_WIDTH: u32 = 440;
const CONTROL_MIN_WINDOW_HEIGHT: u32 = 420;
// 主界面（home）比设置窗大，且不能小于它的创建尺寸，否则「记录上次大小」会把它压小。
const HOME_MIN_WINDOW_WIDTH: u32 = 800;
const HOME_MIN_WINDOW_HEIGHT: u32 = 520;
const CONTROL_WINDOW_MARGIN: i32 = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowLayout {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct WindowLayouts {
    main: Option<WindowLayout>,
    control: Option<WindowLayout>,
    home: Option<WindowLayout>,
}

pub fn save_window_layout(app: AppHandle) -> Result<WindowLayout, String> {
    save_window_layout_for_label(&app, "main")
}

pub fn save_window_layout_for_label(app: &AppHandle, label: &str) -> Result<WindowLayout, String> {
    let layout = current_window_layout(app, label)?;
    let mut layouts = read_window_layouts(app)?.unwrap_or_default();
    set_stored_window_layout(&mut layouts, label, layout.clone())?;
    write_window_layouts(app, &layouts)?;
    tracing::info!(
        target: "livebell::window",
        label = label,
        x = layout.x,
        y = layout.y,
        width = layout.width,
        height = layout.height,
        "window layout saved"
    );
    Ok(layout)
}

pub fn load_window_layout(app: AppHandle) -> Result<Option<WindowLayout>, String> {
    Ok(read_window_layouts(&app)?.and_then(|layout| layout.main))
}

pub(super) fn restore_window_layout(app: &AppHandle) {
    let layouts = match read_window_layouts(app) {
        Ok(layout) => layout.unwrap_or_default(),
        Err(error) => {
            tracing::warn!(
                target: "livebell::window",
                error = %error,
                "failed to read saved window layout"
            );
            WindowLayouts::default()
        }
    };

    if let Some(layout) = layouts.main {
        restore_window_layout_for_label(app, "main", &layout);
    }

    if let Some(layout) = layouts.control {
        restore_window_layout_for_label(app, "control", &layout);
    } else {
        position_control_window_below_overlay(app);
    }
}

/// 主界面（home）上次保存的布局；由 open_home_window 在建窗时恢复。
pub(super) fn home_window_layout(app: &AppHandle) -> Option<WindowLayout> {
    read_window_layouts(app)
        .ok()
        .flatten()
        .and_then(|layouts| layouts.home)
}

pub(super) fn restore_window_layout_for_label(
    app: &AppHandle,
    label: &str,
    layout: &WindowLayout,
) {
    let Some(window) = app.get_webview_window(label) else {
        tracing::warn!(
            target: "livebell::window",
            label = label,
            "window not found when restoring layout"
        );
        return;
    };

    let size = PhysicalSize::new(
        layout.width.max(min_window_width(label)),
        layout.height.max(min_window_height(label)),
    );
    // 保存的是窗口可见区（inner）尺寸，这里也必须用它去恢复；混用 outer_size 与 set_size
    // 会把窗口边框（Windows 上大约 +16/+39）叠加进去，点一次托盘窗口就长一点。
    if let Err(error) = window.set_size(Size::Physical(PhysicalSize::new(size.width, size.height)))
    {
        tracing::warn!(
            target: "livebell::window",
            label = label,
            error = %error,
            "failed to restore window size"
        );
    }

    let position = clamp_window_position(&window, PhysicalPosition::new(layout.x, layout.y), size);
    if let Err(error) = window.set_position(Position::Physical(position)) {
        tracing::warn!(
            target: "livebell::window",
            label = label,
            error = %error,
            "failed to restore window position"
        );
    }

    tracing::info!(
        target: "livebell::window",
        label = label,
        x = position.x,
        y = position.y,
        width = size.width,
        height = size.height,
        "window layout restored"
    );
}

fn position_control_window_below_overlay(app: &AppHandle) {
    let position = || -> Result<PhysicalPosition<i32>, String> {
        let main = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        let control = app
            .get_webview_window("control")
            .ok_or_else(|| "control window not found".to_string())?;
        let main_position = main.outer_position().map_err(|error| error.to_string())?;
        let main_size = main.outer_size().map_err(|error| error.to_string())?;
        let control_size = control.outer_size().map_err(|error| error.to_string())?;

        let x = main_position.x + (main_size.width as i32 - control_size.width as i32) / 2;
        let y = main_position.y + main_size.height as i32 + CONTROL_WINDOW_MARGIN;

        Ok(clamp_window_position(
            &control,
            PhysicalPosition::new(x, y),
            control_size,
        ))
    };

    match position() {
        Ok(position) => {
            if let Some(window) = app.get_webview_window("control") {
                if let Err(error) = window.set_position(Position::Physical(position)) {
                    tracing::warn!(
                        target: "livebell::window",
                        error = %error,
                        "failed to position control window"
                    );
                }
            }
        }
        Err(error) => tracing::warn!(
            target: "livebell::window",
            error = %error,
            "failed to calculate control window position"
        ),
    }
}

fn current_window_layout(app: &AppHandle, label: &str) -> Result<WindowLayout, String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window not found: {}", label))?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;

    Ok(WindowLayout {
        x: position.x,
        y: position.y,
        width: size.width.max(min_window_width(label)),
        height: size.height.max(min_window_height(label)),
    })
}

// 窗口事件里的 Moved/Resized 恢复一次布局就会连着来一串，全部落盘既刷日志又和恢复打架。
// 每个 label 合并成一次写入：第一次事件后等 DEBOUNCE，期间的后续事件只更新时间点。
const LAYOUT_SAVE_DEBOUNCE: Duration = Duration::from_millis(400);

/// 记下这个 label 下一次该落盘的时间点，返回给调用方等待。
fn begin_layout_save_debounce(label: &str) -> Option<Instant> {
    let deadline = Instant::now() + LAYOUT_SAVE_DEBOUNCE;
    let mut pending = layout_save_debounce().lock().ok()?;
    pending.insert(label.to_string(), deadline);
    Some(deadline)
}

/// 期间又来了新事件就返回新的时间点，否则保持原样。
fn latest_layout_save_deadline(label: &str) -> Option<Instant> {
    let mut pending = layout_save_debounce().lock().ok()?;
    pending.remove(label)
}

fn layout_save_debounce() -> &'static Mutex<HashMap<String, Instant>> {
    static DEBOUNCE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    DEBOUNCE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 窗口事件入口：隐藏/最小化时产生的 Resized 不保存（那正是托盘点击把窗口撑大的元凶），
/// 可见时按 label 做 400ms 防抖。
pub(super) fn schedule_window_layout_save(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }

    let Some(deadline) = begin_layout_save_debounce(label) else {
        return;
    };
    let handle = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        let mut scheduled = deadline;
        loop {
            tokio::time::sleep(LAYOUT_SAVE_DEBOUNCE).await;
            if let Some(next) = latest_layout_save_deadline(&label) {
                scheduled = next;
            }
            if Instant::now() >= scheduled {
                break;
            }
        }
        if let Err(error) = save_window_layout_for_label(&handle, &label) {
            tracing::warn!(
                target: "livebell::window",
                label = label.as_str(),
                error = %error,
                "failed to save window layout from window event"
            );
        }
    });
}

fn read_window_layouts(app: &AppHandle) -> Result<Option<WindowLayouts>, String> {
    let path = window_layout_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| error.to_string())?;

    if value.get("main").is_some()
        || value.get("control").is_some()
        || value.get("home").is_some()
    {
        serde_json::from_value(value)
            .map(Some)
            .map_err(|error| error.to_string())
    } else {
        let main = serde_json::from_value(value).map_err(|error| error.to_string())?;
        Ok(Some(WindowLayouts {
            main: Some(main),
            control: None,
            home: None,
        }))
    }
}

fn write_window_layouts(app: &AppHandle, layout: &WindowLayouts) -> Result<(), String> {
    let path = window_layout_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let content = serde_json::to_string_pretty(layout).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn set_stored_window_layout(
    layouts: &mut WindowLayouts,
    label: &str,
    layout: WindowLayout,
) -> Result<(), String> {
    match label {
        "main" => layouts.main = Some(layout),
        "control" => layouts.control = Some(layout),
        "home" => layouts.home = Some(layout),
        _ => return Err(format!("unsupported window layout label: {}", label)),
    }
    Ok(())
}

fn min_window_width(label: &str) -> u32 {
    match label {
        "main" => MIN_WINDOW_WIDTH,
        "home" => HOME_MIN_WINDOW_WIDTH,
        _ => CONTROL_MIN_WINDOW_WIDTH,
    }
}

fn min_window_height(label: &str) -> u32 {
    match label {
        "main" => MIN_WINDOW_HEIGHT,
        "home" => HOME_MIN_WINDOW_HEIGHT,
        _ => CONTROL_MIN_WINDOW_HEIGHT,
    }
}

fn clamp_window_position(
    window: &tauri::WebviewWindow,
    position: PhysicalPosition<i32>,
    window_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return position;
    };
    let work_area = monitor.work_area();
    let min_x = work_area.position.x;
    let min_y = work_area.position.y;
    let max_x = min_x + work_area.size.width.saturating_sub(window_size.width) as i32;
    let max_y = min_y + work_area.size.height.saturating_sub(window_size.height) as i32;

    PhysicalPosition::new(
        position.x.clamp(min_x, max_x.max(min_x)),
        position.y.clamp(min_y, max_y.max(min_y)),
    )
}

fn window_layout_path(_app: &AppHandle) -> Result<std::path::PathBuf, String> {
    crate::portable::data_root().map(|path| path.join(WINDOW_LAYOUT_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn per_label_minimums_keep_the_home_window_bigger() {
        assert_eq!(min_window_width("main"), MIN_WINDOW_WIDTH);
        assert_eq!(min_window_height("main"), MIN_WINDOW_HEIGHT);
        assert_eq!(min_window_width("home"), HOME_MIN_WINDOW_WIDTH);
        assert_eq!(min_window_height("home"), HOME_MIN_WINDOW_HEIGHT);
        assert_eq!(min_window_width("control"), CONTROL_MIN_WINDOW_WIDTH);
        assert_eq!(min_window_height("control"), CONTROL_MIN_WINDOW_HEIGHT);
    }

    /// 托盘点击一次会带来一串 Moved/Resized；它们必须合并成一次保存，
    /// 否则「恢复布局 → 触发事件 → 又保存」会把窗口一路撑大。
    #[test]
    fn repeated_window_events_share_one_debounced_save() {
        let label = "debounce-test-window";
        let first = begin_layout_save_debounce(label).expect("debounce slot");
        let mut latest = first;
        for _ in 0..5 {
            std::thread::sleep(Duration::from_millis(5));
            latest = begin_layout_save_debounce(label).expect("debounce slot");
        }

        assert!(latest > first, "后到的事件必须把落盘时间点往后推");
        let observed = latest_layout_save_deadline(label).expect("pending save");
        assert_eq!(observed, latest);
        // 取走之后就没有待保存的记录了。
        assert_eq!(latest_layout_save_deadline(label), None);
    }

    #[test]
    fn debounce_is_tracked_per_label() {
        let main = begin_layout_save_debounce("debounce-main").expect("debounce slot");
        let home = begin_layout_save_debounce("debounce-home").expect("debounce slot");

        assert_eq!(latest_layout_save_deadline("debounce-home"), Some(home));
        assert_eq!(latest_layout_save_deadline("debounce-main"), Some(main));
    }
}
