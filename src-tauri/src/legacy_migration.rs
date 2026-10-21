//! 从旧品牌名（EiheiLing / 诶嘿铃）迁移到 LiveBell 的一次性兼容层。
//!
//! 2.1.0 起程序改名为 LiveBell，`identifier`、登录凭据服务名、开机自启值名、Toast AUMID、
//! 开始菜单快捷方式都跟着换了。老用户升级后如果什么都不做，会「看起来像重装」：
//! 登录态丢了、自启没了、系统通知不显示。
//!
//! 这里在启动早期做四件事（任何一步失败都只记 warn，不影响启动）：
//! 1. 旧的登录凭据搬到新服务名下（确认新条目能读回之后才删旧的）；
//! 2. HKCU Run 里当前实例对应的旧值 `EiheiLing{suffix}` 改名成 `LiveBell{suffix}`，内容指向当前 exe；
//! 3. 删掉开始菜单里旧的 `诶嘿铃*.lnk`；
//! 4. 删掉旧的 `EiheiLing.Desktop*` AUMID 注册表项。
//!
//! 另外，如果当前目录还没有 `Data/app-config.json`、而旧版 exe 目录（从旧 Run 值里读出来）有，
//! 就把旧 `Data/` 整体复制过来——用户把新版拷到新文件夹时不用手动搬数据。
//! 同目录覆盖升级时 `Data/` 本来就在，这一步自然跳过。
//!
//! **注意：本文件里的旧名字是刻意写死的，不要跟着仓库改名替换掉。**

use std::path::{Path, PathBuf};
use tracing::{info, warn};

/// 旧的可执行文件名前缀（正式版 `EiheiLing`，测试版 `EiheiLing-Test`）。
const LEGACY_EXE_STEM: &str = "EiheiLing";
/// 旧的开始菜单快捷方式前缀（正式版 `诶嘿铃.lnk`）。
const LEGACY_SHORTCUT_PREFIX: &str = "诶嘿铃";
/// 旧的 Toast AUMID 前缀（正式版 `EiheiLing.Desktop`）。
const LEGACY_AUMID_PREFIX: &str = "EiheiLing.Desktop";
/// 旧的登录凭据服务名（旧 identifier + `.bilibili.auth`）。
const LEGACY_SECRET_SERVICE: &str = "com.kyaru.eiheiling.bilibili.auth";
/// 凭据条目里的账号名，新旧一致。
const SECRET_ACCOUNT: &str = "bilibili-cookie-bundle";

#[cfg(windows)]
const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const AUMID_KEY_PATH: &str = r"Software\Classes\AppUserModelId";

/// 执行全部迁移。只在 Windows 上有实际动作。
pub fn migrate() {
    #[cfg(windows)]
    {
        // 顺序有讲究：数据目录迁移要读旧 Run 值，所以放在自启迁移（会删旧值）之前。
        migrate_data_dir();
        migrate_credential();
        migrate_autostart();
        migrate_start_menu();
        migrate_aumid();
    }
}

/// 枚举 HKCU Run 里以旧 exe 名开头的值，返回 (值名, 启动命令)。
#[cfg(windows)]
fn legacy_run_values() -> Vec<(String, String)> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let mut found = Vec::new();
    let Ok(run) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN_KEY_PATH) else {
        return found;
    };
    for (name, _) in run.enum_values().flatten() {
        if !name.starts_with(LEGACY_EXE_STEM) {
            continue;
        }
        if let Ok(command) = run.get_value::<String, _>(&name) {
            found.push((name, command));
        }
    }
    found
}

/// 从启动命令里取出 exe 路径：支持带引号与不带引号两种写法。
fn exe_path_from_command(command: &str) -> Option<PathBuf> {
    let rest = command.trim();
    let path = match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next()?,
        None => rest.split_whitespace().next()?,
    };
    let path = PathBuf::from(path);
    // 只认 .exe，避免把 `--background` 之类的参数当成路径。
    let is_exe = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
    is_exe.then_some(path)
}

/// 当前目录还没有配置数据、旧版目录有时，把旧 `Data/` 复制过来。
#[cfg(windows)]
fn migrate_data_dir() {
    let Ok(current_exe) = std::env::current_exe() else {
        return;
    };
    let Some(current_dir) = current_exe.parent() else {
        return;
    };
    let current_data = current_dir.join("Data");
    if current_data.join("app-config.json").is_file() {
        // 同目录覆盖升级：数据本来就在，不用搬。
        return;
    }

    for (_, command) in legacy_run_values() {
        let Some(old_exe) = exe_path_from_command(&command) else {
            continue;
        };
        let Some(old_dir) = old_exe.parent() else {
            continue;
        };
        if old_dir == current_dir {
            continue;
        }
        let old_data = old_dir.join("Data");
        if !old_data.join("app-config.json").is_file() {
            continue;
        }
        match copy_dir_all(&old_data, &current_data) {
            Ok(files) => {
                info!(
                    target: "livebell::migration",
                    from = %old_data.display(),
                    to = %current_data.display(),
                    files,
                    "migrated data directory from legacy install"
                );
                // 配置里的头像路径是绝对路径，不跟着换目录的话，前端读不到新目录里的头像。
                rewrite_avatar_paths(&current_data.join("app-config.json"), &old_data, &current_data);
            }
            Err(error) => warn!(
                target: "livebell::migration",
                from = %old_data.display(),
                to = %current_data.display(),
                %error,
                "failed to migrate data directory from legacy install"
            ),
        }
        return;
    }
}

/// 把配置里指向旧 `Data/` 的绝对头像路径改写成新目录。
#[cfg(windows)]
fn rewrite_avatar_paths(config_path: &Path, old_data: &Path, new_data: &Path) {
    let Ok(text) = std::fs::read_to_string(config_path) else {
        return;
    };
    let old_prefix = old_data.to_string_lossy().to_string();
    let new_prefix = new_data.to_string_lossy().to_string();
    let Some((updated, rewritten)) = rewrite_avatar_paths_in_config(&text, &old_prefix, &new_prefix)
    else {
        return;
    };

    match std::fs::write(config_path, updated) {
        Ok(()) => info!(
            target: "livebell::migration",
            avatars = rewritten,
            to = %new_data.display(),
            "rewrote avatar paths to the new data directory"
        ),
        Err(error) => warn!(
            target: "livebell::migration",
            %error,
            "failed to write rewritten app config"
        ),
    }
}

/// 纯文本改写：把 `savedRooms[].avatarPath` 里的旧目录前缀换成新目录。
///
/// 没有可改的条目时返回 `None`，调用方据此跳过写盘（避免无谓地重写配置）。
fn rewrite_avatar_paths_in_config(
    text: &str,
    old_prefix: &str,
    new_prefix: &str,
) -> Option<(String, usize)> {
    let mut value = serde_json::from_str::<serde_json::Value>(text).ok()?;
    let mut rewritten = 0usize;

    if let Some(rooms) = value.get_mut("savedRooms").and_then(|rooms| rooms.as_array_mut()) {
        for room in rooms {
            let Some(path) = room
                .get("avatarPath")
                .and_then(|path| path.as_str())
                .map(str::to_string)
            else {
                continue;
            };
            let Some(rest) = path.strip_prefix(old_prefix) else {
                continue;
            };
            if let Some(slot) = room.get_mut("avatarPath") {
                *slot = serde_json::Value::String(format!("{new_prefix}{rest}"));
                rewritten += 1;
            }
        }
    }

    if rewritten == 0 {
        return None;
    }
    Some((serde_json::to_string_pretty(&value).ok()?, rewritten))
}

/// 递归复制目录；`logs/` 不复制（旧日志没有迁移价值，还可能被旧进程占用）。
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<usize> {
    std::fs::create_dir_all(dst)?;
    let mut copied = 0;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let file_type = entry.file_type()?;
        let target = dst.join(&file_name);
        if file_type.is_dir() {
            if file_name.to_string_lossy().eq_ignore_ascii_case("logs") {
                continue;
            }
            copied += copy_dir_all(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// 把旧服务名下的登录凭据搬到新服务名（新条目已存在时只清理旧的）。
#[cfg(windows)]
fn migrate_credential() {
    let Ok(old_entry) = keyring::Entry::new(LEGACY_SECRET_SERVICE, SECRET_ACCOUNT) else {
        return;
    };
    let Ok(secret) = old_entry.get_password() else {
        // 没有旧凭据（新用户或早就迁移过），静默返回。
        return;
    };
    let Ok(new_entry) = keyring::Entry::new(
        crate::bilibili::session::SECRET_SERVICE,
        crate::bilibili::session::SECRET_ACCOUNT,
    ) else {
        return;
    };

    if new_entry.get_password().is_err() {
        if let Err(error) = new_entry.set_password(&secret) {
            warn!(
                target: "livebell::migration",
                %error,
                "failed to write login credential under new service name; keeping legacy entry"
            );
            return;
        }
        if new_entry.get_password().is_err() {
            warn!(
                target: "livebell::migration",
                "new login credential could not be read back; keeping legacy entry"
            );
            return;
        }
    }

    if let Err(error) = old_entry.delete_credential() {
        warn!(
            target: "livebell::migration",
            %error,
            "failed to delete legacy login credential"
        );
    } else {
        info!(
            target: "livebell::migration",
            service = crate::bilibili::session::SECRET_SERVICE,
            "migrated login credential"
        );
    }
}

/// 把当前实例的旧 Run 值改名成新值名，内容用当前 exe 路径。
#[cfg(windows)]
fn migrate_autostart() {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    let suffix = crate::instance_id::suffix();
    let old_name = format!("{LEGACY_EXE_STEM}{suffix}");
    let new_name = format!("LiveBell{suffix}");

    let Ok(run) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY_PATH, KEY_READ | KEY_WRITE)
    else {
        return;
    };
    if run.get_value::<String, _>(&old_name).is_err() {
        return;
    }

    if run.get_value::<String, _>(&new_name).is_err() {
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let command = format!("\"{}\" --background", exe.display());
        if let Err(error) = run.set_value(&new_name, &command) {
            warn!(
                target: "livebell::migration",
                value = %new_name,
                %error,
                "failed to write autostart value under new name"
            );
            return;
        }
    }

    if let Err(error) = run.delete_value(&old_name) {
        warn!(
            target: "livebell::migration",
            value = %old_name,
            %error,
            "failed to delete legacy autostart value"
        );
    } else {
        info!(
            target: "livebell::migration",
            from = %old_name,
            to = %new_name,
            "migrated autostart registry value"
        );
    }
}

/// 删掉开始菜单里旧的「诶嘿铃*.lnk」（新快捷方式由 toast 注册流程创建）。
#[cfg(windows)]
fn migrate_start_menu() {
    let Ok(appdata) = std::env::var("APPDATA") else {
        return;
    };
    let programs = PathBuf::from(appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs");
    let Ok(entries) = std::fs::read_dir(&programs) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(LEGACY_SHORTCUT_PREFIX) || !name.ends_with(".lnk") {
            continue;
        }
        match std::fs::remove_file(entry.path()) {
            Ok(()) => info!(
                target: "livebell::migration",
                shortcut = %name,
                "removed legacy start menu shortcut"
            ),
            Err(error) => warn!(
                target: "livebell::migration",
                shortcut = %name,
                %error,
                "failed to remove legacy start menu shortcut"
            ),
        }
    }
}

/// 删掉旧的 AUMID 注册表项（`EiheiLing.Desktop`、`EiheiLing.Desktop-Test`）。
#[cfg(windows)]
fn migrate_aumid() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(root) = hkcu.open_subkey(AUMID_KEY_PATH) else {
        return;
    };
    let names: Vec<String> = root.enum_keys().flatten().collect();
    for name in names {
        if !name.starts_with(LEGACY_AUMID_PREFIX) {
            continue;
        }
        match hkcu.delete_subkey_all(format!("{AUMID_KEY_PATH}\\{name}")) {
            Ok(()) => info!(
                target: "livebell::migration",
                aumid = %name,
                "removed legacy aumid registry key"
            ),
            Err(error) => warn!(
                target: "livebell::migration",
                aumid = %name,
                %error,
                "failed to remove legacy aumid registry key"
            ),
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{exe_path_from_command, rewrite_avatar_paths_in_config};
    use std::path::PathBuf;

    #[test]
    fn parses_quoted_command() {
        assert_eq!(
            exe_path_from_command("\"C:\\Apps\\EiheiLing.exe\" --background"),
            Some(PathBuf::from("C:\\Apps\\EiheiLing.exe"))
        );
    }

    #[test]
    fn parses_unquoted_command() {
        assert_eq!(
            exe_path_from_command("C:\\Apps\\EiheiLing.exe --background"),
            Some(PathBuf::from("C:\\Apps\\EiheiLing.exe"))
        );
    }

    #[test]
    fn rejects_non_exe() {
        assert_eq!(exe_path_from_command("--background"), None);
    }

    #[test]
    fn rewrites_avatar_paths_from_old_data_dir() {
        let config = r#"{
            "savedRooms": [
                { "id": "a", "avatarPath": "E:\\Old\\Data\\Avatars\\a.jpg" },
                { "id": "b", "avatarPath": "E:\\Elsewhere\\b.jpg" },
                { "id": "c" }
            ]
        }"#;

        let (updated, count) = rewrite_avatar_paths_in_config(
            config,
            r"E:\Old\Data",
            r"E:\New\Data",
        )
        .expect("old avatar path should be rewritten");

        assert_eq!(count, 1);
        let value: serde_json::Value = serde_json::from_str(&updated).unwrap();
        let rooms = value["savedRooms"].as_array().unwrap();
        assert_eq!(
            rooms[0]["avatarPath"].as_str(),
            Some(r"E:\New\Data\Avatars\a.jpg")
        );
        // 不在旧目录里的路径保持原样。
        assert_eq!(rooms[1]["avatarPath"].as_str(), Some(r"E:\Elsewhere\b.jpg"));
        assert!(rooms[2].get("avatarPath").is_none() || rooms[2]["avatarPath"].is_null());
    }

    #[test]
    fn leaves_config_untouched_when_no_avatar_matches() {
        let config = r#"{ "savedRooms": [ { "id": "a", "avatarPath": "E:\\New\\Data\\a.jpg" } ] }"#;
        assert!(rewrite_avatar_paths_in_config(config, r"E:\Old\Data", r"E:\New\Data").is_none());
    }
}
