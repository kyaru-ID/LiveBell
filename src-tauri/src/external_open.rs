//! 用系统默认浏览器打开外部链接（直播间、更新发布页等）。
//!
//! 为什么不用 tauri-plugin-opener 的 `openUrl`：该插件对 `open` crate 显式启用了
//! `shellexecute-on-windows`，内部直接调 `ShellExecuteExW`。实测在 LiveBell 进程里调用它
//! **返回成功（前端拿到 null、日志无错）但浏览器不会打开**；同一台机器上用
//! `cmd /c start "" <url>` 或 `Start-Process <url>` 都能正常打开，说明问题出在那条
//! 调用路径上。这里自己实现，并把失败信息返回给前端（不再静默吞掉）。

use tracing::{info, warn};

/// cmd 的 `start` 需要显式的窗口标题占位参数，否则第一个带引号的参数会被当成标题。
const START_TITLE_PLACEHOLDER: &str = "";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 只允许 http/https：避免把 `file://`、`javascript:` 之类的链接交给系统。
fn validate_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("链接不能为空。".to_string());
    }
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err(format!("只支持 http/https 链接：{trimmed}"));
    }
    Ok(trimmed)
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_url(&url)?;
    open_in_default_browser(url)
}

fn open_in_default_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        // cmd start 优先。实测（同一台机器、同一 Medium 完整性级别）：
        //   · `cmd /c start "" <url>` → 浏览器真的打开；
        //   · ShellExecuteW             → 返回 >32（文档意义的「成功」）但浏览器毫无反应。
        // 也就是说 ShellExecuteW 的返回值不可信，不能靠它判断成败，只能先把更可靠的那条路走掉。
        match cmd_start(url) {
            Ok(()) => Ok(()),
            Err(primary_error) => {
                warn!(
                    target: "livebell::external",
                    url,
                    error = %primary_error,
                    "cmd start failed, falling back to ShellExecuteW"
                );
                shell_execute_w(url).map_err(|fallback_error| {
                    format!("打开链接失败：{primary_error}；改用 ShellExecuteW 也失败：{fallback_error}")
                })
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("当前平台暂不支持打开外部链接。".to_string())
    }
}

/// ShellExecuteW 的返回值 <= 32 表示失败（见 Win32 文档）。
#[cfg(windows)]
fn shell_execute_w(url: &str) -> Result<(), String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    unsafe {
        // 忽略返回值：RPC_E_CHANGED_MODE 说明线程已属于别的 apartment，仍可继续调用。
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let operation = HSTRING::from("open");
        let file = HSTRING::from(url);
        let result = ShellExecuteW(
            None,
            &operation,
            &file,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        let code = result.0 as isize;
        if code <= 32 {
            Err(format!("ShellExecuteW 返回 {code}"))
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
fn cmd_start(url: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let mut command = std::process::Command::new("cmd");
    command
        .arg("/c")
        .arg("start")
        .arg(START_TITLE_PLACEHOLDER)
        .arg(url)
        .creation_flags(CREATE_NO_WINDOW);

    match command.spawn() {
        Ok(_) => {
            info!(target: "livebell::external", url, "opened url with cmd start");
            Ok(())
        }
        Err(error) => {
            warn!(target: "livebell::external", url, error = %error, "failed to spawn cmd start");
            Err(format!("启动 cmd 失败：{error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_url;

    #[test]
    fn accepts_http_and_https() {
        assert_eq!(validate_url(" https://live.bilibili.com/1 ").unwrap(), "https://live.bilibili.com/1");
        assert!(validate_url("http://example.com").is_ok());
    }

    #[test]
    fn rejects_empty_and_other_schemes() {
        assert!(validate_url("   ").is_err());
        assert!(validate_url("file:///C:/Windows").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
    }
}
