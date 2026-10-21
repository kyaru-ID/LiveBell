//! B 站主播名搜索（对齐 C# 版 BilibiliStreamerProfileProvider）。
//!
//! 注意：主站搜索接口 `search/type` 需要浏览器设备指纹（buvid3/buvid4）才会返回 JSON，
//! 否则会被风控拦成 HTML 错误页，所以这里先取 buvid 再带 Cookie 请求；
//! 搜索结果里通常直接带 room_id，缺失时才回查 room_id_by_uid。

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use reqwest::header::{ACCEPT, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, warn};

use super::http::fetch_buvid;
use super::types::{response_preview, ApiResponse};

pub(crate) const SEARCH_TYPE_URL: &str = "https://api.bilibili.com/x/web-interface/search/type";
pub(crate) const SEARCH_ALL_URL: &str = "https://api.bilibili.com/x/web-interface/search/all/v2";
const ROOM_ID_BY_UID_URL: &str = "https://api.live.bilibili.com/room/v2/Room/room_id_by_uid";
const SEARCH_REFERER: &str = "https://search.bilibili.com/";
const LIVE_REFERER: &str = "https://live.bilibili.com/";
/// 用 Windows Chrome UA：实测匿名搜索要这个 UA 配合 buvid 才拿得到 JSON。
const SEARCH_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
pub(crate) const MAX_CANDIDATES: usize = 3;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_ATTEMPTS: usize = 3;
const RETRY_BASE_DELAY_MS: u64 = 400;
const CACHE_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const CACHE_MAX_ENTRIES: usize = 100;

/// 搜索串行化，避免连续请求触发风控。
static SEARCH_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static SEARCH_CACHE: LazyLock<Mutex<HashMap<String, CachedSearch>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerCandidate {
    pub uid: u64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_id: Option<u64>,
}

struct CachedSearch {
    stored_at: Instant,
    candidates: Vec<StreamerCandidate>,
}

#[derive(Debug, Deserialize)]
struct SearchTypeData {
    #[serde(default)]
    result: Vec<SearchUserItem>,
}

#[derive(Debug, Deserialize)]
struct SearchUserItem {
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    mid: u64,
    #[serde(default)]
    uname: String,
    #[serde(default)]
    upic: String,
    #[serde(default)]
    room_id: u64,
}

#[derive(Debug, Deserialize)]
struct SearchAllData {
    #[serde(default)]
    result: Vec<SearchAllSection>,
}

#[derive(Debug, Deserialize)]
struct SearchAllSection {
    #[serde(default, rename = "result_type")]
    result_type: String,
    #[serde(default)]
    data: Vec<SearchUserItem>,
}

#[derive(Debug, Deserialize)]
struct RoomIdByUidData {
    #[serde(default)]
    room_id: u64,
}

/// 按主播名搜索，返回最多 3 个候选。
pub(crate) async fn search_streamers(keyword: &str) -> Result<Vec<StreamerCandidate>, String> {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return Err("请输入主播名。".to_string());
    }

    let cache_key = keyword.to_lowercase();
    let _gate = SEARCH_GATE.lock().await;

    let device = fetch_buvid().await.ok();
    let cookie = device.as_ref().map(|device| device.cookie.as_str());

    let mut last_error: Option<String> = None;
    let mut items = Vec::new();

    match fetch_search_type(keyword, cookie).await {
        Ok(found) => items = found,
        Err(error) => {
            warn!(target: "livebell::bilibili.search", %error, "bili_user search failed; trying all/v2");
            last_error = Some(error);
        }
    }

    if items.is_empty() {
        match fetch_search_all(keyword, cookie).await {
            Ok(found) => items = found,
            Err(error) => {
                warn!(target: "livebell::bilibili.search", %error, "search all/v2 failed");
                if last_error.is_none() {
                    last_error = Some(error);
                }
            }
        }
    }

    if items.is_empty() {
        if let Some(cached) = cached_candidates(&cache_key).await {
            debug!(target: "livebell::bilibili.search", keyword, count = cached.len(), "using cached streamer search result");
            return Ok(cached);
        }
        if let Some(error) = last_error {
            return Err(error);
        }
        return Ok(Vec::new());
    }

    let mut candidates = Vec::new();
    for item in items.into_iter().take(MAX_CANDIDATES) {
        let name = strip_tags(&item.uname);
        if item.mid == 0 || name.trim().is_empty() {
            continue;
        }
        let room_id = if item.room_id > 0 {
            Some(item.room_id)
        } else {
            fetch_room_id_by_uid(item.mid, cookie).await.unwrap_or(None)
        };
        // upic 偶尔是空串（B 站搜索接口不稳定），此时用 card 兜一次，
        // 免得候选列表里出现没头像的空白项。
        let avatar_url = match normalize_image_url(&item.upic) {
            Some(url) => Some(url),
            None => super::avatar_cache::fetch_user_face(item.mid)
                .await
                .ok()
                .and_then(|face| normalize_image_url(&face)),
        };
        candidates.push(StreamerCandidate {
            uid: item.mid,
            name,
            avatar_url,
            room_id,
        });
    }

    store_cache(cache_key, &candidates).await;
    debug!(target: "livebell::bilibili.search", keyword, count = candidates.len(), "streamer search finished");
    Ok(candidates)
}

#[tauri::command]
pub async fn streamer_search(keyword: String) -> Result<Vec<StreamerCandidate>, String> {
    search_streamers(&keyword).await
}

async fn fetch_search_type(
    keyword: &str,
    cookie: Option<&str>,
) -> Result<Vec<SearchUserItem>, String> {
    let query = vec![
        ("search_type", "bili_user".to_string()),
        ("page", "1".to_string()),
        ("page_size", MAX_CANDIDATES.to_string()),
        ("keyword", keyword.to_string()),
    ];
    let data: SearchTypeData =
        get_api(SEARCH_TYPE_URL, SEARCH_REFERER, cookie, &query, "主播搜索").await?;
    Ok(data
        .result
        .into_iter()
        .filter(|item| item.kind.is_empty() || item.kind == "bili_user")
        .collect())
}

async fn fetch_search_all(
    keyword: &str,
    cookie: Option<&str>,
) -> Result<Vec<SearchUserItem>, String> {
    let query = vec![("page", "1".to_string()), ("keyword", keyword.to_string())];
    let data: SearchAllData =
        get_api(SEARCH_ALL_URL, SEARCH_REFERER, cookie, &query, "主播搜索兜底").await?;
    Ok(data
        .result
        .into_iter()
        .filter(|section| section.result_type == "bili_user")
        .flat_map(|section| section.data)
        .collect())
}

async fn fetch_room_id_by_uid(uid: u64, cookie: Option<&str>) -> Result<Option<u64>, String> {
    let query = vec![("uid", uid.to_string())];
    let data: RoomIdByUidData =
        get_api(ROOM_ID_BY_UID_URL, LIVE_REFERER, cookie, &query, "主播直播间查询").await?;
    Ok((data.room_id > 0).then_some(data.room_id))
}

async fn get_api<T: for<'de> Deserialize<'de>>(
    url: &str,
    referer: &str,
    cookie: Option<&str>,
    query: &[(&str, String)],
    label: &str,
) -> Result<T, String> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("{label}客户端创建失败：{error}"))?;

    let mut last_error = format!("{label}请求失败。");
    for attempt in 0..MAX_ATTEMPTS {
        match get_api_once::<T>(&client, url, referer, cookie, query, label).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = error;
                if attempt + 1 < MAX_ATTEMPTS {
                    let delay = RETRY_BASE_DELAY_MS * (1 << attempt);
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
            }
        }
    }
    Err(last_error)
}

async fn get_api_once<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    referer: &str,
    cookie: Option<&str>,
    query: &[(&str, String)],
    label: &str,
) -> Result<T, String> {
    let mut request = client
        .get(url)
        .header(ACCEPT, "application/json, text/plain, */*")
        .header(USER_AGENT, SEARCH_USER_AGENT)
        .header(REFERER, referer)
        .query(query);

    if let Some(cookie) = cookie {
        if !cookie.is_empty() {
            request = request.header("Cookie", cookie);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("{label}请求失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("{label}响应读取失败：{error}"))?;

    if !status.is_success() {
        return Err(format!("{label} HTTP {status}：{}", response_preview(&bytes)));
    }

    let parsed = serde_json::from_slice::<ApiResponse<T>>(&bytes).map_err(|error| {
        format!(
            "{label} JSON 解析失败：{error}；响应片段：{}",
            response_preview(&bytes)
        )
    })?;

    if parsed.code != 0 {
        return Err(format!(
            "{label}返回错误：{} {}",
            parsed.code, parsed.message
        ));
    }

    parsed.data.ok_or_else(|| format!("{label}响应缺少 data 字段"))
}

async fn cached_candidates(key: &str) -> Option<Vec<StreamerCandidate>> {
    let cache = SEARCH_CACHE.lock().await;
    cache
        .get(key)
        .filter(|entry| entry.stored_at.elapsed() < CACHE_TTL)
        .map(|entry| entry.candidates.clone())
}

async fn store_cache(key: String, candidates: &[StreamerCandidate]) {
    let mut cache = SEARCH_CACHE.lock().await;
    if cache.len() >= CACHE_MAX_ENTRIES {
        if let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, entry)| entry.stored_at)
            .map(|(key, _)| key.clone())
        {
            cache.remove(&oldest);
        }
    }
    cache.insert(
        key,
        CachedSearch {
            stored_at: Instant::now(),
            candidates: candidates.to_vec(),
        },
    );
}

/// B 站搜索结果的用户名可能带 `<em class="keyword">` 高亮标签，需要剥掉。
pub(crate) fn strip_tags(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

pub(crate) fn normalize_image_url(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Some(rest) = value.strip_prefix("//") {
        return Some(format!("https://{rest}"));
    }
    if let Some(rest) = value.strip_prefix("http://") {
        return Some(format!("https://{rest}"));
    }
    Some(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_tags_removes_highlight_markup() {
        assert_eq!(strip_tags("<em class=\"keyword\">老番茄</em>"), "老番茄");
        assert_eq!(strip_tags("A &amp; B"), "A & B");
    }

    #[test]
    fn normalize_image_url_prefixes_protocol() {
        assert_eq!(
            normalize_image_url("//i1.hdslb.com/bfs/face/x.jpg"),
            Some("https://i1.hdslb.com/bfs/face/x.jpg".to_string())
        );
        assert_eq!(normalize_image_url("  "), None);
        assert_eq!(
            normalize_image_url("https://i1.hdslb.com/a.png"),
            Some("https://i1.hdslb.com/a.png".to_string())
        );
    }
}
