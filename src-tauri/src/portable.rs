use std::path::{Path, PathBuf};

/// 便携数据目录名，固定位于可执行文件同级。
const DATA_DIR_NAME: &str = "Data";
/// 环境变量覆盖，便于开发期或调试时把数据挪到别处。
const DATA_DIR_ENV: &str = "LIVEBELL_DATA_DIR";

/// 便携数据根目录：可执行文件旁的 `Data/`。
///
/// LiveBell 以便携形态分发（解压即用），所有可写数据都跟随程序本体，
/// 因此不使用系统用户目录（%APPDATA% / %LOCALAPPDATA%）。
pub fn data_root() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV) {
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    let exe = std::env::current_exe().map_err(|error| format!("可执行文件路径获取失败：{error}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| format!("可执行文件所在目录解析失败：{}", exe.display()))?;
    Ok(dir.join(DATA_DIR_NAME))
}

/// 日志目录：`Data/logs/`。
pub fn logs_dir() -> Result<PathBuf, String> {
    data_root().map(|root| root.join("logs"))
}

/// 确保目录存在（含多级父目录）。
pub fn ensure_dir(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|error| format!("目录创建失败：{error} (path={})", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_root_ends_with_data_dir() {
        let root = data_root().expect("data_root should resolve");
        assert!(root.ends_with(DATA_DIR_NAME));
    }

    #[test]
    fn logs_dir_nests_under_data_root() {
        let logs = logs_dir().expect("logs_dir should resolve");
        assert!(logs.ends_with(DATA_DIR_NAME.to_string() + "/logs") || logs.ends_with(DATA_DIR_NAME.to_string() + "\\logs"));
    }
}
