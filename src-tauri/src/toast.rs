//! Windows 系统通知（Toast）——对齐 C# 版 ToastNotificationService 的语义。
//!
//! 桌面应用发 Toast 需要 AUMID 与开始菜单快捷方式（或注册表项）对得上，
//! 因此注册流程做四件事：
//! 1. 写 `HKCU\\Software\\Classes\\AppUserModelId\\{AUMID}`（DisplayName / IconUri / ShowInSettings）；
//! 2. 在开始菜单 Programs 目录创建带 AUMID 的快捷方式；
//! 3. SHChangeNotify(SHCNE_ASSOCCHANGED) 让 Shell 索引立刻刷新；
//! 4. SetCurrentProcessExplicitAppUserModelID 把当前进程的 AUMID 对齐。
//! 注册失败只记录一次、之后不再重试（与 C# 一致，避免刷日志）。

use std::sync::{LazyLock, Mutex};
use tracing::{info, warn};

/// AUMID 与快捷方式名都带实例后缀（见 instance_id）：正式版是 `LiveBell.Desktop` / `LiveBell.lnk`，
/// 测试版是 `LiveBell.Desktop-Test` / `LiveBell-Test.lnk`。否则测试版一注册 toast，就会把开始菜单里
/// 正式版的快捷方式覆盖成指向测试版 exe。
fn aumid() -> String {
    format!("LiveBell.Desktop{}", crate::instance_id::suffix())
}

fn shortcut_name() -> String {
    format!("LiveBell{}.lnk", crate::instance_id::suffix())
}
const TOAST_RETRY_ATTEMPTS: u32 = 5;
const TOAST_RETRY_DELAY_MS: u64 = 400;

#[derive(Default)]
struct RegistrationState {
    attempted: bool,
    error: Option<String>,
}

static REGISTRATION: LazyLock<Mutex<RegistrationState>> =
    LazyLock::new(|| Mutex::new(RegistrationState::default()));

/// 发送「已开播」系统通知；silent=true 时通知静音（软件自己播提示音）。
pub fn notify_live_started(
    streamer_name: &str,
    title: &str,
    room_url: &str,
    silent: bool,
    avatar_path: Option<&str>,
) -> Result<(), String> {
    ensure_registered()?;
    let xml = build_toast_xml(streamer_name, title, room_url, silent, avatar_path);
    platform::show(&xml)
}

fn ensure_registered() -> Result<(), String> {
    let mut state = REGISTRATION.lock().unwrap_or_else(|error| error.into_inner());
    if state.attempted {
        return match &state.error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        };
    }

    state.attempted = true;
    match platform::register() {
        Ok(()) => {
            info!(target: "livebell::toast", aumid = %aumid(), "windows toast registered");
            Ok(())
        }
        Err(error) => {
            warn!(target: "livebell::toast", %error, "windows toast registration failed");
            state.error = Some(error.clone());
            Err(error)
        }
    }
}

fn build_toast_xml(
    streamer_name: &str,
    title: &str,
    room_url: &str,
    silent: bool,
    avatar_path: Option<&str>,
) -> String {
    let heading = format!("{} 已开播！", escape_xml(streamer_name));
    let body = escape_xml(title);
    let mut xml = String::new();
    xml.push_str(&format!(
        "<toast activationType=\"protocol\" launch=\"{}\">",
        escape_xml(room_url)
    ));
    xml.push_str("<visual><binding template=\"ToastGeneric\">");
    xml.push_str(&format!("<text>{heading}</text><text>{body}</text>"));
    // 与 C# 版一致：头像放在 appLogoOverride 位置、圆形裁切。头像文件缺失时
    // 就退化成不带头像的通知，不影响正文（头像取不到不该让整条通知失败）。
    if let Some(uri) = avatar_image_uri(avatar_path) {
        xml.push_str(&format!(
            "<image placement=\"appLogoOverride\" hint-crop=\"circle\" src=\"{}\"/>",
            escape_xml(&uri)
        ));
    }
    xml.push_str("</binding></visual>");
    if silent {
        xml.push_str("<audio silent=\"true\"/>");
    }
    xml.push_str("</toast>");
    xml
}

/// 把本地头像路径转成 Toast 能加载的 `file:///` URI；路径为空或文件不存在时返回 None。
fn avatar_image_uri(avatar_path: Option<&str>) -> Option<String> {
    let path = avatar_path?.trim();
    if path.is_empty() || !std::path::Path::new(path).is_file() {
        return None;
    }
    Some(format!("file:///{}", encode_uri_path(&path.replace('\\', "/"))))
}

/// 最小百分号编码：保留 URI 路径里的安全字符，其余（含中文、空格）逐字节编码。
fn encode_uri_path(path: &str) -> String {
    const SAFE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~/:+";
    let mut encoded = String::with_capacity(path.len());
    for byte in path.bytes() {
        let character = byte as char;
        if byte.is_ascii() && SAFE.contains(character) {
            encoded.push(character);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(windows)]
mod platform {
    use super::{aumid, shortcut_name, TOAST_RETRY_ATTEMPTS, TOAST_RETRY_DELAY_MS};
    use std::path::PathBuf;
    use std::time::Duration;

    use windows::core::{Interface, GUID, HSTRING, PCWSTR};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        SetCurrentProcessExplicitAppUserModelID, ShellLink, IShellLinkW, SHChangeNotify,
        SHCNE_ASSOCCHANGED, SHCNF_IDLIST,
    };

    /// PKEY_AppUserModel_ID = {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, 5
    const PKEY_APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3),
        pid: 5,
    };

    pub fn register() -> Result<(), String> {
        write_registry()?;
        create_start_menu_shortcut()?;

        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
            let aumid = HSTRING::from(aumid());
            SetCurrentProcessExplicitAppUserModelID(PCWSTR(aumid.as_ptr()))
                .map_err(|error| format!("设置进程 AUMID 失败：{error}"))?;
        }

        Ok(())
    }

    fn write_registry() -> Result<(), String> {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = format!("Software\\Classes\\AppUserModelId\\{}", aumid());
        let (key, _) = hkcu
            .create_subkey(&path)
            .map_err(|error| format!("写入 AUMID 注册表项失败：{error}"))?;

        key.set_value("DisplayName", &"LiveBell".to_string())
            .map_err(|error| format!("写入 DisplayName 失败：{error}"))?;
        if let Ok(exe) = std::env::current_exe() {
            let _ = key.set_value("IconUri", &exe.to_string_lossy().to_string());
        }
        key.set_value("ShowInSettings", &1u32)
            .map_err(|error| format!("写入 ShowInSettings 失败：{error}"))?;
        Ok(())
    }

    fn create_start_menu_shortcut() -> Result<(), String> {
        let appdata = std::env::var("APPDATA")
            .map_err(|error| format!("读取 APPDATA 环境变量失败：{error}"))?;
        let programs = PathBuf::from(appdata)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs");
        std::fs::create_dir_all(&programs)
            .map_err(|error| format!("创建开始菜单目录失败：{error}"))?;

        let shortcut_path = programs.join(shortcut_name());
        let exe = std::env::current_exe()
            .map_err(|error| format!("读取当前程序路径失败：{error}"))?;

        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| format!("创建 IShellLink 失败：{error}"))?;

            let exe_wide = HSTRING::from(exe.to_string_lossy().to_string());
            shell_link
                .SetPath(PCWSTR(exe_wide.as_ptr()))
                .map_err(|error| format!("设置快捷方式目标失败：{error}"))?;

            let property_store: IPropertyStore = shell_link
                .cast()
                .map_err(|error| format!("获取 IPropertyStore 失败：{error}"))?;
            let value = PROPVARIANT::from(aumid().as_str());
            property_store
                .SetValue(&PKEY_APP_USER_MODEL_ID, &value)
                .map_err(|error| format!("写入快捷方式 AUMID 失败：{error}"))?;
            property_store
                .Commit()
                .map_err(|error| format!("提交快捷方式属性失败：{error}"))?;

            let persist: IPersistFile = shell_link
                .cast()
                .map_err(|error| format!("获取 IPersistFile 失败：{error}"))?;
            let shortcut_wide = HSTRING::from(shortcut_path.to_string_lossy().to_string());
            persist
                .Save(&shortcut_wide, true)
                .map_err(|error| format!("保存快捷方式失败：{error}"))?;
        }

        Ok(())
    }

    pub fn show(xml: &str) -> Result<(), String> {
        let document = XmlDocument::new().map_err(|error| format!("创建通知 XML 失败：{error}"))?;
        document
            .LoadXml(&HSTRING::from(xml))
            .map_err(|error| format!("解析通知 XML 失败：{error}"))?;
        let toast = ToastNotification::CreateToastNotification(&document)
            .map_err(|error| format!("创建通知对象失败：{error}"))?;

        let aumid = HSTRING::from(aumid());
        let mut last_error = String::from("未知错误");
        for _ in 0..TOAST_RETRY_ATTEMPTS {
            match ToastNotificationManager::CreateToastNotifierWithId(&aumid) {
                Ok(notifier) => match notifier.Show(&toast) {
                    Ok(()) => return Ok(()),
                    Err(error) => last_error = error.to_string(),
                },
                Err(error) => last_error = error.to_string(),
            }
            // Shell 索引 AUMID 是异步的，失败后退避重试。
            std::thread::sleep(Duration::from_millis(TOAST_RETRY_DELAY_MS));
        }

        Err(format!("系统通知发送失败：{last_error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{avatar_image_uri, encode_uri_path};

    #[test]
    fn encodes_non_ascii_and_spaces_in_uri_path() {
        assert_eq!(encode_uri_path("E:/a b/头像.jpg"), "E:/a%20b/%E5%A4%B4%E5%83%8F.jpg");
    }

    #[test]
    fn toast_names_carry_instance_suffix() {
        let suffix = crate::instance_id::suffix();
        assert_eq!(super::aumid(), format!("LiveBell.Desktop{suffix}"));
        assert_eq!(super::shortcut_name(), format!("LiveBell{suffix}.lnk"));
    }

    #[test]
    fn avatar_uri_is_none_for_missing_file() {
        assert!(avatar_image_uri(Some("E:/definitely/missing.png")).is_none());
        assert!(avatar_image_uri(None).is_none());
        assert!(avatar_image_uri(Some("   ")).is_none());
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn register() -> Result<(), String> {
        Err("系统通知仅支持 Windows".to_string())
    }

    pub fn show(_xml: &str) -> Result<(), String> {
        Err("系统通知仅支持 Windows".to_string())
    }
}
