//! 命令行参数解析：与 C# 版 App.xaml.cs 对齐（--background / --preview）。
//!
//! 注意：单实例后缀**不**由这里的 --preview 决定，而是按 exe 文件名在 `instance_id` 里算
//! （正式版 `LiveBell.exe` 无后缀，测试版换个文件名就自动隔离开）。

use serde::Serialize;

/// 开机自启用：后台启动，不显示主窗口，只留托盘与开播监听。
pub const BACKGROUND_FLAG: &str = "--background";
/// 预览模式（历史参数，保留兼容；不再影响单实例锁）。
pub const PREVIEW_FLAG: &str = "--preview";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    pub background: bool,
    pub preview: bool,
}

impl LaunchArgs {
    /// 大小写不敏感地识别参数（同 C# 的 OrdinalIgnoreCase 比较）。
    pub fn parse<I, S>(args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut parsed = Self::default();
        for arg in args {
            let arg = arg.as_ref();
            if arg.eq_ignore_ascii_case(BACKGROUND_FLAG) {
                parsed.background = true;
            } else if arg.eq_ignore_ascii_case(PREVIEW_FLAG) {
                parsed.preview = true;
            }
        }
        parsed
    }

    pub fn from_env() -> Self {
        Self::parse(std::env::args())
    }

}

/// 前端据此判断本次是不是「开机自启」的后台启动（后台启动不进弹幕编辑模式）。
#[tauri::command]
pub fn launch_args(args: tauri::State<'_, LaunchArgs>) -> LaunchArgs {
    *args
}

#[cfg(test)]
mod tests {
    use super::LaunchArgs;

    /// 这条测试读进程**自己**的 exe 名：cargo test 的测试二进制叫 `livebell_lib-<hash>.exe`，
    /// 后缀是 `_lib-<hash>`，因此它恰好证明「换了文件名的进程不会和正式版共用同一套资源名」。
    #[test]
    fn test_binary_gets_its_own_suffix() {
        let suffix = crate::instance_id::init_current_instance();
        assert!(
            !suffix.is_empty(),
            "测试二进制的文件名应该算出非空后缀，实际拿到了空串"
        );
    }

    #[test]
    fn parses_background_flag() {
        let args = LaunchArgs::parse(["livebell.exe", "--background"]);
        assert!(args.background);
        assert!(!args.preview);
    }

    #[test]
    fn ignores_unrelated_arguments() {
        let args = LaunchArgs::parse(["livebell.exe", "--other", "value"]);
        assert_eq!(args, LaunchArgs::default());
    }

    #[test]
    fn flag_matching_is_case_insensitive() {
        let args = LaunchArgs::parse(["livebell.exe", "--PREVIEW"]);
        assert!(args.preview);
    }
}
