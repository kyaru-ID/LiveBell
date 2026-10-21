//! 头像本地缓存（对齐 C# 版 BilibiliStreamerProfileProvider.CacheAvatarAsync）。
//!
//! 关注列表读本地文件（Data/Avatars/{key}.jpg），离线也显示得出来、系统 Toast 也能复用同一张图。
//! 取图链路：room/v1/Room/get_info(room_id) → data.uid → x/web-interface/card?mid=uid
//! → data.card.face → 下载图片字节写盘。
//! 文件按 SavedRoom.id 命名（sanitize 后），所以主播换房间号也能复用同一张缓存。

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tracing::{debug, warn};

use super::streamer_search::normalize_image_url;
use super::types::response_preview;

const ROOM_INFO_URL: &str = "https://api.live.bilibili.com/room/v1/Room/get_info";
const USER_CARD_URL: &str = "https://api.bilibili.com/x/web-interface/card";
const LIVE_REFERER: &str = "https://live.bilibili.com/";
const SPACE_REFERER: &str = "https://space.bilibili.com/";
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const AVATAR_DIR_NAME: &str = "Avatars";
const AVATAR_EXTENSION: &str = "jpg";
/// 单张头像上限，防止异常响应把磁盘写满。
const MAX_AVATAR_BYTES: usize = 8 * 1024 * 1024;
/// 一次补齐最多并发下载几张，别把 B 站惹毛。
const MAX_CONCURRENCY: usize = 3;

#[derive(Debug, Deserialize)]
struct RoomInfoResponse {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<RoomInfoData>,
}

#[derive(Debug, Deserialize)]
struct RoomInfoData {
    #[serde(default)]
    uid: u64,
}

#[derive(Debug, Deserialize)]
struct UserCardResponse {
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<UserCardData>,
}

#[derive(Debug, Deserialize)]
struct UserCardData {
    #[serde(default)]
    card: Option<UserCard>,
}

#[derive(Debug, Deserialize)]
struct UserCard {
    #[serde(default)]
    face: String,
}

pub(crate) fn avatars_dir() -> Result<PathBuf, String> {
    Ok(crate::portable::data_root()?.join(AVATAR_DIR_NAME))
}

fn avatar_file_path(key: &str) -> Result<PathBuf, String> {
    Ok(avatars_dir()?.join(format!(
        "{}.{}",
        sanitize_key(key),
        AVATAR_EXTENSION
    )))
}

/// SavedRoom.id 可能含分隔符等文件名字符，统一换成下划线。
fn sanitize_key(key: &str) -> String {
    let sanitized: String = key
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "avatar".to_string()
    } else {
        sanitized
    }
}

/// 本地已有就直接用（对齐 C#：文件在就不重复下载）。
pub(crate) fn existing_avatar_path(key: &str) -> Option<String> {
    let path = avatar_file_path(key).ok()?;
    path.is_file().then(|| path.to_string_lossy().to_string())
}

/// 下载并缓存一个房间的头像，返回本地绝对路径。
pub(crate) async fn cache_room_avatar(room_id: &str, key: &str) -> Result<String, String> {
    if let Some(existing) = existing_avatar_path(key) {
        return Ok(existing);
    }

    let room_id = room_id.trim();
    if room_id.is_empty() {
        return Err("房间号不能为空。".to_string());
    }

    let uid = fetch_room_uid(room_id).await?;
    let face = fetch_user_face(uid).await?;
    let bytes = download_image(&face).await?;

    let path = avatar_file_path(key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("头像目录创建失败：{error}"))?;
    }
    std::fs::write(&path, &bytes).map_err(|error| format!("头像写入失败：{error}"))?;
    debug!(target: "livebell::bilibili.avatar", %room_id, uid, bytes = bytes.len(), "avatar cached");
    Ok(path.to_string_lossy().to_string())
}

/// 取一个房间的头像本地路径，供临时连接的卡片显示。
///
/// 关注列表里已经有同一个房间时复用它的缓存 key（一张头像不存两份）；
/// 纯临时连接的房间拿房间号当 key。失败只记日志——头像不是连接的必需品。
pub(crate) async fn ensure_room_avatar(app: &AppHandle, room_id: u64) -> Option<String> {
    let room_id_text = room_id.to_string();
    let key = crate::app_config::read_app_config(app)
        .ok()
        .and_then(|config| {
            config
                .saved_rooms
                .iter()
                .find(|room| room.room_id == room_id_text)
                .map(|room| room.id.clone())
        })
        .unwrap_or_else(|| room_id_text.clone());

    match cache_room_avatar(&room_id_text, &key).await {
        Ok(path) => Some(path),
        Err(error) => {
            warn!(
                target: "livebell::bilibili.avatar",
                room_id,
                %error,
                "temporary room avatar cache failed"
            );
            None
        }
    }
}

pub(crate) async fn fetch_room_uid(room_id: &str) -> Result<u64, String> {
    let query = vec![("room_id", room_id.to_string())];
    let parsed: RoomInfoResponse = get_json(ROOM_INFO_URL, LIVE_REFERER, &query, "直播间信息").await?;
    if parsed.code != 0 {
        return Err(format!(
            "直播间信息返回错误：code={} message={}",
            parsed.code, parsed.message
        ));
    }
    let data = parsed
        .data
        .ok_or_else(|| "直播间信息响应缺少 data 字段".to_string())?;
    if data.uid == 0 {
        return Err("直播间信息响应缺少主播 uid".to_string());
    }
    Ok(data.uid)
}

pub(crate) async fn fetch_user_face(uid: u64) -> Result<String, String> {
    let query = vec![("mid", uid.to_string())];
    let parsed: UserCardResponse = get_json(USER_CARD_URL, SPACE_REFERER, &query, "主播资料").await?;
    if parsed.code != 0 {
        return Err(format!(
            "主播资料返回错误：code={} message={}",
            parsed.code, parsed.message
        ));
    }
    let face = parsed
        .data
        .and_then(|data| data.card)
        .map(|card| card.face)
        .unwrap_or_default();
    if face.trim().is_empty() {
        return Err("主播资料里没有头像地址".to_string());
    }
    Ok(face)
}

/// 关注列表补齐头像：对齐 C# 老版进入列表时把缺失的头像补上。
/// 返回本次成功补齐的张数；失败只记日志，不影响其它房间。
#[tauri::command]
pub async fn sync_room_avatars(app: AppHandle) -> Result<u32, String> {
    let config = crate::app_config::read_app_config(&app)?;
    let pending: Vec<(String, String)> = config
        .saved_rooms
        .iter()
        .filter(|room| !room.room_id.trim().is_empty())
        // 判断「当前 Data/Avatars 里有没有这张图」，而不是配置里那个 avatar_path 指向的文件在不在：
        // 换目录后（例如把 exe 挪到别的文件夹）配置里存的还是旧绝对路径，文件仍存在，
        // 只按 avatar_path 判断就永远不会重新补齐。
        .filter(|room| {
            avatar_file_path(&room.id)
                .map(|path| !path.is_file())
                .unwrap_or(true)
        })
        .map(|room| (room.id.clone(), room.room_id.clone()))
        .collect();

    if pending.is_empty() {
        return Ok(0);
    }

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENCY));
    let mut tasks: JoinSet<(String, Result<String, String>)> = JoinSet::new();
    for (id, room_id) in pending {
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|error| format!("头像补齐并发控制失败：{error}"))?;
        tasks.spawn(async move {
            let _permit = permit;
            let key = id.clone();
            (id, cache_room_avatar(&room_id, &key).await)
        });
    }

    let mut updated: Vec<(String, String)> = Vec::new();
    while let Some(result) = tasks.join_next().await {
        match result {
            Ok((id, Ok(path))) => updated.push((id, path)),
            Ok((id, Err(error))) => {
                warn!(target: "livebell::bilibili.avatar", %id, %error, "avatar cache failed");
            }
            Err(error) => {
                warn!(target: "livebell::bilibili.avatar", %error, "avatar task failed");
            }
        }
    }

    if updated.is_empty() {
        return Ok(0);
    }

    let count = updated.len() as u32;
    crate::app_config::update_app_config_atomically(&app, move |config, _latest| {
        // 头像路径属于后端权威字段，这里直接按 id 写回。
        for room in &mut config.saved_rooms {
            if let Some((_, path)) = updated.iter().find(|(id, _)| id == &room.id) {
                room.avatar_path = Some(path.clone());
            }
        }
    })?;
    debug!(target: "livebell::bilibili.avatar", count, "saved room avatars synced");
    Ok(count)
}

/// 清空本地头像缓存并全部重新获取（对齐 C# 老版设置里的「头像缓存 → 清理缓存」按钮）。
#[tauri::command]
pub async fn refresh_room_avatars(app: AppHandle) -> Result<u32, String> {
    let dir = avatars_dir()?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|error| format!("头像缓存清理失败：{error}"))?;
    }
    debug!(target: "livebell::bilibili.avatar", "avatar cache cleared, refetching");
    sync_room_avatars(app).await
}

async fn download_image(url: &str) -> Result<Vec<u8>, String> {
    let normalized = normalize_image_url(url).ok_or_else(|| "主播头像地址为空。".to_string())?;
    let response = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("主播头像客户端创建失败：{error}"))?
        .get(&normalized)
        .header(reqwest::header::ACCEPT, "image/avif,image/webp,image/*,*/*;q=0.8")
        .header(reqwest::header::USER_AGENT, BROWSER_USER_AGENT)
        .header(reqwest::header::REFERER, SPACE_REFERER)
        .send()
        .await
        .map_err(|error| format!("主播头像下载失败：{error}"))?;

    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("主播头像响应读取失败：{error}"))?;

    if !status.is_success() {
        return Err(format!(
            "主播头像下载返回 HTTP {status}：{}",
            response_preview(&bytes)
        ));
    }
    if bytes.is_empty() {
        return Err("主播头像内容为空。".to_string());
    }
    if bytes.len() > MAX_AVATAR_BYTES {
        return Err(format!("主播头像过大（{} 字节）。", bytes.len()));
    }

    Ok(bytes.to_vec())
}

async fn get_json<T: for<'de> Deserialize<'de>>(
    url: &str,
    referer: &str,
    query: &[(&str, String)],
    label: &str,
) -> Result<T, String> {
    let response = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("{label}客户端创建失败：{error}"))?
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json, text/plain, */*")
        .header(reqwest::header::USER_AGENT, BROWSER_USER_AGENT)
        .header(reqwest::header::REFERER, referer)
        .query(query)
        .send()
        .await
        .map_err(|error| format!("{label}请求失败：{error}"))?;

    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("{label}响应读取失败：{error}"))?;

    if !status.is_success() {
        return Err(format!(
            "{label}请求返回 HTTP {status}：{}",
            response_preview(&bytes)
        ));
    }

    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{label}响应解析失败：{error}：{}", response_preview(&bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_key_keeps_safe_characters_only() {
        assert_eq!(sanitize_key("room-1a2b_3"), "room-1a2b_3");
        assert_eq!(sanitize_key("room/1 a2"), "room_1_a2");
        assert_eq!(sanitize_key(""), "avatar");
    }
}
