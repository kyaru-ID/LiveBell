//! 实例身份：同一台机器上可以同时跑多个「LiveBell」（正式版、测试版……）。
//!
//! 单实例锁、开机自启注册表值、Toast 的 AUMID、开始菜单快捷方式，这些名字都是**全机共享**
//! 的。以前它们写死成不带后缀的常量，于是从测试目录启动测试版时：
//! 1. 会被正式版的单实例互斥体挡住，直接把自己唤醒后退出；
//! 2. 勾一次开机自启，会把正式版的 Run 值改成测试版 exe 的路径；
//! 3. 会覆盖开始菜单里的「LiveBell.lnk」，让正式版的通知图标变成测试版。
//!
//! 现在改成**按 exe 文件名取后缀**：正式版 `LiveBell.exe` 后缀为空，所有资源名与以前完全一致；
//! 测试版随便换个文件名（例如 `LiveBell-Test.exe`）就自动后缀 `-Test`，与正式版井水不犯河水，
//! 不需要记命令行参数，也不会因为漏带参数而把正式版关掉。

use std::path::Path;
use std::sync::OnceLock;

/// 正式版的 exe 文件名（不含扩展名，大小写不敏感）。
pub const RELEASE_EXE_STEM: &str = "LiveBell";

/// 从 exe 文件名算实例后缀：正式版返回空串；其他名字取 `LiveBell` 之后的尾巴。
///
/// 例：`LiveBell` 返回空串，`LiveBell-Test` 返回 `-Test`，`livebell-preview` 返回 `-preview`，
/// 完全不含 `LiveBell` 的名字则原样返回（宁可多一个隔离的名字，也不能撞上正式版）。
pub fn instance_suffix_from_stem(stem: &str) -> String {
    if stem.eq_ignore_ascii_case(RELEASE_EXE_STEM) {
        return String::new();
    }
    match stem.to_ascii_lowercase().find(&RELEASE_EXE_STEM.to_ascii_lowercase()) {
        Some(index) => stem[index + RELEASE_EXE_STEM.len()..].to_string(),
        None => stem.to_string(),
    }
}

/// 进程级缓存的实例后缀（在 lib.rs 的 run() 一开头就初始化）。
static INSTANCE_SUFFIX: OnceLock<String> = OnceLock::new();

/// 当前进程的实例名后缀，供各模块拼资源名用；未初始化时按正式版（空后缀）。
pub fn suffix() -> &'static str {
    INSTANCE_SUFFIX.get().map(String::as_str).unwrap_or("")
}

/// 调试用守卫：设置环境变量 LIVEBELL_NO_SINGLE_INSTANCE=1 时不抢单实例锁，直接当作首实例
/// （让 lldb / WinDbg 附加进去排查启动问题，不用先关正在运行的正式版）。
pub fn bypass_guard() -> crate::single_instance::InstanceGuard {
    crate::single_instance::InstanceGuard::primary_unlocked()
}

/// 按当前 exe 文件名确定实例身份；重复调用只生效一次。须在换名相关初始化之前调用。
pub fn init_current_instance() -> &'static str {
    // 注意：这一步跑在日志初始化之前，这里的 tracing 不一定落盘，别指望靠它排查问题。
    let path = std::env::current_exe().map(|path| path.display().to_string()).unwrap_or_default();
    let suffix = INSTANCE_SUFFIX.get_or_init(current_instance_suffix);
    tracing::debug!(target: "livebell::app", suffix = %suffix, exe = %path, "instance identity");
    suffix
}

/// 取当前进程 exe 文件名的实例后缀；读不到自身路径时退回正式版（空后缀）。
pub fn current_instance_suffix() -> String {
    match std::env::current_exe() {
        Ok(path) => instance_suffix_from_exe_path(&path),
        Err(_) => String::new(),
    }
}

/// 同 [`current_instance_suffix`]，但从给定路径取，便于测试。
pub fn instance_suffix_from_exe_path(path: &Path) -> String {
    match path.file_stem().and_then(|stem| stem.to_str()) {
        Some(stem) => instance_suffix_from_stem(stem),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{instance_suffix_from_exe_path, instance_suffix_from_stem, RELEASE_EXE_STEM};
    use std::path::Path;

    #[test]
    fn release_exe_has_no_suffix() {
        assert_eq!(RELEASE_EXE_STEM.len(), 8);
        assert_eq!(instance_suffix_from_stem("LiveBell"), "");
        // 大小写不敏感：Windows 上文件名本来就不区分大小写。
        assert_eq!(instance_suffix_from_stem("livebell"), "");
        assert_eq!(instance_suffix_from_stem("LIVEBELL"), "");
    }

    #[test]
    fn other_exe_names_become_the_suffix() {
        assert_eq!(instance_suffix_from_stem("LiveBell-Test"), "-Test");
        assert_eq!(instance_suffix_from_stem("LiveBell-Preview"), "-Preview");
        assert_eq!(instance_suffix_from_stem("livebell-dev"), "-dev");
        // 完全不含 LiveBell 的名字不能被算成正式版（否则会和正式版抢同一个锁）。
        assert_eq!(instance_suffix_from_stem("foo"), "foo");
    }

    #[test]
    fn init_is_idempotent() {
        // 测试进程本身叫 livebell-<hash>.exe，取什么值不重要，只要幂等且与 current 一致。
        let first = super::init_current_instance();
        let second = super::init_current_instance();
        assert_eq!(first, second);
        assert_eq!(first, super::suffix());
        assert_eq!(first, super::current_instance_suffix());
    }

    #[test]
    fn suffix_is_taken_from_exe_path() {
        assert_eq!(
            instance_suffix_from_exe_path(Path::new(r"E:\EheRing 1.0\LiveBell.exe")),
            ""
        );
        assert_eq!(
            instance_suffix_from_exe_path(Path::new(r"E:\Test\LiveBell\LiveBell-Test.exe")),
            "-Test"
        );
    }
}
