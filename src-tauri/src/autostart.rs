//! 开机自启：与 C# 版 Services/AutoStartService.cs 对齐。
//!
//! 往 HKCU 的 Run 键写一条值（值名 LiveBell，内容为带引号的 exe 路径 + --background），
//! 登录 Windows 后由系统拉起。注册表被组策略或权限限制时把错误交给前端提示，
//! 不影响提醒功能本身（C# 版是整段 try/catch 静默）。

/// 注册表值名前缀，沿用 C# 版 AutoStartService.ValueName。
/// 真正写进去的名字是「前缀 + 实例后缀」：正式版还是 `LiveBell`，测试版是 `LiveBell-Test`，
/// 否则测试版勾一次自启就会把正式版的 Run 值改写成测试版 exe 的路径。
#[cfg(windows)]
const VALUE_NAME_PREFIX: &str = "LiveBell";

/// 当前实例的注册表值名。
#[cfg(windows)]
fn value_name() -> String {
    format!("{}{}", VALUE_NAME_PREFIX, crate::instance_id::suffix())
}

/// 拼自启命令行：路径带引号，避免安装目录含空格时被系统拆成两个参数。
pub fn autostart_command(exe_path: &str) -> String {
    format!("\"{exe_path}\" --background")
}

#[tauri::command]
pub fn autostart_is_enabled() -> bool {
    #[cfg(windows)]
    {
        platform::is_enabled().unwrap_or_else(|error| {
            tracing::warn!(
                target: "livebell::autostart",
                error = %error,
                "failed to read autostart state"
            );
            false
        })
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub fn autostart_set_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        match platform::set_enabled(enabled) {
            Ok(()) => {
                tracing::info!(
                    target: "livebell::autostart",
                    enabled,
                    "autostart preference updated"
                );
                Ok(())
            }
            Err(error) => {
                tracing::warn!(
                    target: "livebell::autostart",
                    enabled,
                    error = %error,
                    "failed to update autostart preference"
                );
                Err(error)
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("开机自启仅支持 Windows。".to_string())
    }
}

#[cfg(windows)]
mod platform {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    use super::{autostart_command, value_name};

    const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    /// 值存在即视为已启用（同 C# AutoStartService.IsEnabled）。
    pub fn is_enabled() -> Result<bool, String> {
        let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN_KEY_PATH) {
            Ok(key) => key,
            // Run 键不存在 = 从没设置过自启。
            Err(_) => return Ok(false),
        };

        // 兼容：老版本只有无后缀的 LiveBell 值。正式版（后缀为空）两者本来就是一个名字；
        // 测试版则要用自己的带后缀值，不能把正式版的自启状态当成自己的。
        let name = value_name();
        match key.get_value::<String, _>(&name) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!("读取开机自启注册表值失败：{error}")),
        }
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(RUN_KEY_PATH)
            .map_err(|error| format!("打开开机自启注册表项失败：{error}"))?;

        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|error| format!("获取程序路径失败：{error}"))?;
            let command = autostart_command(&exe_path.to_string_lossy());
            key.set_value(&value_name(), &command)
                .map_err(|error| format!("写入开机自启注册表值失败：{error}"))
        } else {
            match key.delete_value(&value_name()) {
                Ok(()) => Ok(()),
                // 值本来就不在 = 已经是关闭状态。
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!("删除开机自启注册表值失败：{error}")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::autostart_command;

    #[test]
    fn autostart_command_quotes_path_and_appends_background_flag() {
        assert_eq!(
            autostart_command(r"C:\Program Files\LiveBell\livebell.exe"),
            r#""C:\Program Files\LiveBell\livebell.exe" --background"#
        );
    }

    #[cfg(windows)]
    #[test]
    fn value_name_is_prefix_plus_instance_suffix() {
        // 正式版（后缀为空）值名保持不变，与老版本兼容。
        assert_eq!(
            super::VALUE_NAME_PREFIX.to_string() + crate::instance_id::suffix(),
            super::value_name()
        );
    }
}
