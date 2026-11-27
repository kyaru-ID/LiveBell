use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::SystemTime;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tracing_subscriber::fmt::writer::MakeWriterExt;
use tracing_subscriber::EnvFilter;

fn recent_logs(directory: &Path) -> Result<String, String> {
    const MAX_BYTES: u64 = 1024 * 1024;
    let mut files = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
        })
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name == "livebell.log" || name.starts_with("livebell.log.")
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    let mut remaining_bytes = MAX_BYTES;
    let mut remaining_lines = 500;
    let mut blocks = Vec::new();
    for entry in files.into_iter().take(3) {
        if remaining_bytes == 0 || remaining_lines == 0 {
            break;
        }
        let mut file = fs::File::open(entry.path()).map_err(|error| error.to_string())?;
        let length = file.metadata().map_err(|error| error.to_string())?.len();
        let offset = length.saturating_sub(remaining_bytes);
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        let mut bytes = Vec::new();
        file.take(remaining_bytes)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        remaining_bytes -= bytes.len() as u64;
        let content = String::from_utf8_lossy(&bytes);
        let mut all_lines = content.lines();
        if offset > 0 {
            all_lines.next();
        }
        let mut lines: Vec<_> = all_lines.rev().take(remaining_lines).collect();
        remaining_lines -= lines.len();
        lines.reverse();
        blocks.push(format!(
            "--- {} ---\n{}",
            entry.file_name().to_string_lossy(),
            lines.join("\n")
        ));
    }
    blocks.reverse();
    Ok(if blocks.is_empty() {
        "日志文件不存在\n".into()
    } else {
        blocks.join("\n")
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn diagnostics_reads_rolling_logs_and_limits_the_tail() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("livebell.log.2026-11-26"), "昨天\n").unwrap();
        std::fs::write(
            directory.path().join("livebell-diagnostics-old.txt"),
            "不应包含",
        )
        .unwrap();
        std::fs::write(
            directory.path().join("livebell.log.2026-11-27"),
            (0..600)
                .map(|index| format!("日志{index}\n"))
                .collect::<String>(),
        )
        .unwrap();
        let logs = super::recent_logs(directory.path()).unwrap();
        assert!(logs.contains("日志599"));
        assert!(!logs.contains("日志99\n"));
        assert!(!logs.contains("昨天"));
        assert!(!logs.contains("不应包含"));
        assert!(logs.lines().count() <= 501);
    }
}

pub fn init(_app: &AppHandle) -> Result<(), String> {
    let log_dir = crate::portable::logs_dir()?;
    crate::portable::ensure_dir(&log_dir)?;

    let file_appender = tracing_appender::rolling::daily(&log_dir, "livebell.log");
    let writer = std::io::stderr.and(file_appender);
    let filter = EnvFilter::builder()
        .with_env_var("LIVEBELL_LOG")
        .from_env_lossy()
        .add_directive(
            "info"
                .parse()
                .map_err(|error| format!("日志级别解析失败：{}", error))?,
        )
        .add_directive(
            "tauri=info"
                .parse()
                .map_err(|error| format!("日志级别解析失败：{}", error))?,
        )
        .add_directive(
            "wry=warn"
                .parse()
                .map_err(|error| format!("日志级别解析失败：{}", error))?,
        );

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .with_thread_names(false)
        .try_init()
        .map_err(|error| format!("日志初始化失败：{}", error))?;

    tracing::info!(target: "livebell::app", path = %log_dir.display(), "logging initialized");
    Ok(())
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), String> {
    let log_dir = crate::portable::logs_dir()?;
    crate::portable::ensure_dir(&log_dir)?;
    let log_dir = log_dir.to_string_lossy().to_string();
    app.opener()
        .open_path(log_dir, None::<&str>)
        .map_err(|error| format!("日志目录打开失败：{}", error))
}

#[tauri::command]
pub fn export_diagnostics(app: AppHandle) -> Result<String, String> {
    let log_dir = crate::portable::logs_dir()?;
    crate::portable::ensure_dir(&log_dir)?;

    let unix_secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let export_name = format!("livebell-diagnostics-{}.txt", unix_secs);
    let export_path = log_dir.join(&export_name);

    let mut output = String::new();

    // Header
    output.push_str("=== LiveBell 诊断报告 ===\n");
    output.push_str(&format!("生成时间戳：{}\n", unix_secs));
    output.push_str(&format!("应用版本：{}\n", env!("CARGO_PKG_VERSION")));
    output.push_str(&format!("操作系统：{}\n", std::env::consts::OS));
    output.push_str("\n");

    // Log file
    output.push_str("=== 最近日志 ===\n");
    match recent_logs(&log_dir) {
        Ok(logs) => output.push_str(&logs),
        Err(error) => output.push_str(&format!("日志读取失败：{error}\n")),
    }
    output.push_str("\n\n");

    // Config (sanitized)
    output.push_str("=== 应用配置 ===\n");
    match crate::app_config::read_app_config(&app) {
        Ok(config) => {
            let json =
                serde_json::to_string_pretty(&config).unwrap_or_else(|_| "序列化失败".to_string());
            output.push_str(&json);
        }
        Err(error) => {
            output.push_str(&format!("配置读取失败：{}\n", error));
        }
    }
    output.push_str("\n\n");

    // Authentication state (sanitized)
    output.push_str("=== B 站认证状态 ===\n");
    for line in crate::bilibili::auth::diagnostic_lines(&app) {
        output.push_str(&line);
        output.push('\n');
    }
    output.push('\n');

    // Danmaku send state (sanitized)
    output.push_str("=== 弹幕发送状态 ===\n");
    for line in crate::bilibili::send::diagnostic_lines(&app) {
        output.push_str(&line);
        output.push('\n');
    }
    output.push('\n');

    // Environment info
    output.push_str("=== 环境信息 ===\n");
    output.push_str(&format!("OS: {}\n", std::env::consts::OS));
    output.push_str(&format!("Arch: {}\n", std::env::consts::ARCH));
    output.push_str(&format!("Tauri version: {}\n", tauri::VERSION));

    // Write to file
    fs::write(&export_path, &output).map_err(|error| format!("诊断文件写入失败：{}", error))?;

    let path_str = export_path.to_string_lossy().to_string();
    tracing::info!(target: "livebell::diagnostics", path = %path_str, "diagnostics exported");

    // Open the file
    app.opener()
        .open_path(&path_str, None::<&str>)
        .map_err(|error| format!("诊断文件打开失败：{}", error))?;

    Ok(export_name)
}
