//! B 站视频信息 / 弹幕分段的 HTTP 访问层。
//!
//! 只做三件事：把用户输入（BV 号、av 号、视频链接、b23 短链）解析成视频标识；
//! 拉 /x/web-interface/view 拿 cid / 分P / 时长；按 6 分钟一段拉 /x/v2/dm/web/seg.so。
//!
//! 实测（2026-10-25，本机匿名请求）：seg.so 不带 wbi 签名也能拿到数据，
//! 但风控随时可能收紧，所以主路径失败后会再用 WBI 签名重试一次。

use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::header::{ACCEPT, COOKIE, REFERER, USER_AGENT};
use serde::Deserialize;

use super::proto::{parse_seg, DanmakuElem};
use crate::bilibili::http::fetch_wbi_mixin_key;
use crate::bilibili::types::{
    encode_wbi_component, filter_wbi_value, response_preview, ApiResponse, BROWSER_USER_AGENT,
};

const VIEW_URL: &str = "https://api.bilibili.com/x/web-interface/view";
const SEG_URL: &str = "https://api.bilibili.com/x/v2/dm/web/seg.so";
const SEG_WBI_URL: &str = "https://api.bilibili.com/x/v2/dm/wbi/web/seg.so";
const VIDEO_REFERER: &str = "https://www.bilibili.com/";

/// 分段固定时长：B 站把视频按 6 分钟切成弹幕段，segment_index 从 1 开始。
pub(crate) const SEGMENT_MS: u64 = 360_000;

/// 用户输入解析出来的视频标识。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct VideoRef {
    pub aid: Option<u64>,
    pub bvid: Option<String>,
    /// 链接里的 ?p=2，1 起。
    pub page: Option<u32>,
}

impl VideoRef {
    fn is_usable(&self) -> bool {
        self.aid.is_some() || self.bvid.is_some()
    }
}

#[derive(Debug, Clone)]
pub(crate) struct VideoPage {
    pub cid: u64,
    pub page: u32,
    pub part: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct VideoInfo {
    pub aid: u64,
    pub bvid: String,
    pub title: String,
    pub duration_ms: u64,
    pub pages: Vec<VideoPage>,
    /// 链接里 ?p= 指定的分P 原始值（未做范围修正，由 initial_page_index 收敛）。
    pub requested_page: Option<u32>,
}

impl VideoInfo {
    /// 链接里带了 ?p= 就用它，否则第一P。
    pub(crate) fn initial_page_index(&self, requested: Option<u32>) -> usize {
        let requested = requested.unwrap_or(1).max(1) as usize;
        requested
            .saturating_sub(1)
            .min(self.pages.len().saturating_sub(1))
    }
}

/// 是否为 b23.tv / bili2233.cn 短链（需要先跟随重定向才能解析出 BV 号）。
fn looks_like_short_link(input: &str) -> bool {
    let lower = input.to_ascii_lowercase();
    lower.contains("b23.tv") || lower.contains("bili2233.cn")
}

fn parse_query_pairs(raw: &str) -> Vec<(String, String)> {
    let query = raw.split_once('?').map(|(_, rest)| rest).unwrap_or("");
    let query = query.split('#').next().unwrap_or(query);
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

fn page_from_query(raw: &str) -> Option<u32> {
    parse_query_pairs(raw)
        .into_iter()
        .find(|(key, _)| key == "p")
        .and_then(|(_, value)| value.parse::<u32>().ok())
        .filter(|page| *page > 0)
}

fn parse_bvid_candidate(candidate: &str) -> Option<String> {
    let trimmed = candidate.trim();
    if trimmed.len() != 12 || !trimmed[..2].eq_ignore_ascii_case("bv") {
        return None;
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(trimmed.to_string())
}

/// 解析 BV 号 / av 号 / 纯数字 aid / 视频链接 / b23.tv 短链。
///
/// 短链本身解析不出 BV 号，返回的 VideoRef 会是空的，由 resolve_video
/// 先跟随重定向再解析一次。
pub(crate) fn parse_video_input(input: &str) -> Result<VideoRef, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("请输入 BV 号、av 号或视频链接".to_string());
    }

    // 直接输入 BV 号 / av 号 / aid
    if let Some(bvid) = parse_bvid_candidate(trimmed) {
        return Ok(VideoRef {
            aid: None,
            bvid: Some(bvid),
            page: None,
        });
    }
    let lower = trimmed.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("av") {
        if !rest.is_empty() && rest.chars().all(|character| character.is_ascii_digit()) {
            let aid = rest
                .parse::<u64>()
                .map_err(|_| format!("av 号超出范围：{trimmed}"))?;
            return Ok(VideoRef {
                aid: Some(aid),
                bvid: None,
                page: None,
            });
        }
    }
    if trimmed.chars().all(|character| character.is_ascii_digit()) {
        let aid = trimmed
            .parse::<u64>()
            .map_err(|_| format!("av 号超出范围：{trimmed}"))?;
        return Ok(VideoRef {
            aid: Some(aid),
            bvid: None,
            page: None,
        });
    }

    let is_url = trimmed.contains("://")
        || looks_like_short_link(trimmed)
        || trimmed.contains("bilibili.com");
    if !is_url {
        return Err(format!(
            "无法识别的视频标识：{trimmed}（支持 BV 号、av 号、视频链接、b23 短链）"
        ));
    }

    let page = page_from_query(trimmed);
    let without_query = trimmed.split('?').next().unwrap_or(trimmed);
    let without_fragment = without_query.split('#').next().unwrap_or(without_query);

    // 优先找 /video/<BV|av...> 片段
    if let Some((_, tail)) = without_fragment.split_once("/video/") {
        let candidate = tail.split('/').next().unwrap_or("");
        if let Some(bvid) = parse_bvid_candidate(candidate) {
            return Ok(VideoRef {
                aid: None,
                bvid: Some(bvid),
                page,
            });
        }
        let candidate_lower = candidate.to_ascii_lowercase();
        if let Some(rest) = candidate_lower.strip_prefix("av") {
            if !rest.is_empty() && rest.chars().all(|character| character.is_ascii_digit()) {
                let aid = rest
                    .parse::<u64>()
                    .map_err(|_| format!("av 号超出范围：{candidate}"))?;
                return Ok(VideoRef {
                    aid: Some(aid),
                    bvid: None,
                    page,
                });
            }
        }
    }

    // 短链或尚未展开的链接：留空，由 resolve_video 跟随重定向后再解析。
    Ok(VideoRef {
        aid: None,
        bvid: None,
        page,
    })
}

async fn follow_redirect(url: &str) -> Result<String, String> {
    let url = if url.contains("://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(6))
        .build()
        .map_err(|error| format!("短链解析客户端初始化失败：{error}"))?;
    let response = client
        .get(&url)
        .header(USER_AGENT, BROWSER_USER_AGENT)
        .header(REFERER, VIDEO_REFERER)
        .send()
        .await
        .map_err(|error| format!("短链解析请求失败：{error}"))?;
    Ok(response.url().to_string())
}

#[derive(Debug, Deserialize)]
struct ViewData {
    aid: u64,
    bvid: String,
    cid: u64,
    #[serde(default)]
    duration: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    pages: Vec<ViewPageData>,
}

#[derive(Debug, Deserialize)]
struct ViewPageData {
    cid: u64,
    #[serde(default)]
    page: u32,
    #[serde(default)]
    part: String,
    #[serde(default)]
    duration: u64,
}

async fn fetch_view(video: &VideoRef) -> Result<VideoInfo, String> {
    let client = reqwest::Client::new();
    let mut request = client
        .get(VIEW_URL)
        .header(ACCEPT, "application/json, text/plain, */*")
        .header(USER_AGENT, BROWSER_USER_AGENT)
        .header(REFERER, VIDEO_REFERER);
    if let Some(bvid) = video.bvid.as_deref() {
        request = request.query(&[("bvid", bvid)]);
    } else if let Some(aid) = video.aid {
        request = request.query(&[("aid", aid.to_string())]);
    } else {
        return Err("没有解析出视频标识（BV 号或 av 号）".to_string());
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("视频信息请求失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("视频信息响应读取失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "视频信息 HTTP {}：{}",
            status,
            response_preview(&bytes)
        ));
    }

    let parsed: ApiResponse<ViewData> = serde_json::from_slice(&bytes)
        .map_err(|error| format!("视频信息解析失败：{error}（{}）", response_preview(&bytes)))?;
    let data = match (parsed.code, parsed.data) {
        (0, Some(data)) => data,
        (0, None) => return Err("视频信息响应缺少 data 字段".to_string()),
        (code, _) => {
            let hint = match code {
                -404 => "视频不存在或已被删除",
                -400 => "视频标识无效",
                -403 => "视频被限制访问（可能需要登录）",
                _ => "视频信息获取失败",
            };
            return Err(format!("{hint}（code {code}）：{}", parsed.message));
        }
    };

    let fallback_duration_ms = data.duration.saturating_mul(1000);
    let mut pages: Vec<VideoPage> = data
        .pages
        .into_iter()
        .map(|page| VideoPage {
            cid: page.cid,
            page: page.page.max(1),
            part: page.part,
            duration_ms: page.duration.saturating_mul(1000),
        })
        .collect();
    if pages.is_empty() {
        pages.push(VideoPage {
            cid: data.cid,
            page: 1,
            part: data.title.clone(),
            duration_ms: fallback_duration_ms,
        });
    }

    Ok(VideoInfo {
        aid: data.aid,
        bvid: data.bvid,
        title: data.title,
        duration_ms: fallback_duration_ms,
        pages,
        requested_page: video.page,
    })
}

/// 解析用户输入并拉取视频元数据。短链会先跟随重定向。
pub(crate) async fn resolve_video(input: &str) -> Result<VideoInfo, String> {
    let trimmed = input.trim();
    let mut parsed = parse_video_input(trimmed)?;
    if !parsed.is_usable() && looks_like_short_link(trimmed) {
        let final_url = follow_redirect(trimmed).await?;
        parsed = parse_video_input(&final_url)?;
    }
    if !parsed.is_usable() {
        return Err(format!(
            "没能从链接里解析出 BV 号：{trimmed}（请粘贴视频页地址或直接用 BV 号）"
        ));
    }
    fetch_view(&parsed).await
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn is_protobuf(bytes: &[u8]) -> bool {
    // 出错时接口返回 JSON（首字节是大括号），正常时是二进制 protobuf。
    !bytes.is_empty() && bytes[0] != b'{'
}

async fn request_seg(
    url: &str,
    params: &[(String, String)],
    cookie: &str,
) -> Result<Vec<u8>, String> {
    let mut request = reqwest::Client::new()
        .get(url)
        .header(ACCEPT, "*/*")
        .header(USER_AGENT, BROWSER_USER_AGENT)
        .header(REFERER, VIDEO_REFERER);
    if !cookie.is_empty() {
        request = request.header(COOKIE, cookie);
    }
    let response = request
        .query(params)
        .send()
        .await
        .map_err(|error| format!("视频弹幕分段请求失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("视频弹幕分段读取失败：{error}"))?
        .to_vec();
    if !status.is_success() && !is_protobuf(&bytes) {
        return Err(format!(
            "视频弹幕分段 HTTP {}：{}",
            status,
            response_preview(&bytes)
        ));
    }
    Ok(bytes)
}

async fn signed_seg_params(
    aid: u64,
    cid: u64,
    segment_index: u64,
    cookie: &str,
) -> Result<Vec<(String, String)>, String> {
    let mixin = fetch_wbi_mixin_key(cookie).await?;
    let mut params = vec![
        ("oid".to_string(), cid.to_string()),
        ("pid".to_string(), aid.to_string()),
        ("segment_index".to_string(), segment_index.to_string()),
        ("type".to_string(), "1".to_string()),
        ("wts".to_string(), unix_now().to_string()),
    ];
    params.sort_by(|left, right| left.0.cmp(&right.0));
    let query = params
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                encode_wbi_component(key),
                encode_wbi_component(&filter_wbi_value(value))
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    let w_rid = format!("{:x}", md5::compute(format!("{query}{mixin}")));
    params.push(("w_rid".to_string(), w_rid));
    Ok(params)
}

/// 拉取一段弹幕。先用直连，失败再走 WBI 签名。
///
/// `cookie` 是登录态，**必须带**，否则 B 站只回抽样弹幕。实测 BV19rHG6EEfK
/// （3930 条弹幕）：匿名每段只回 67/70/72… 共 578 条；带登录 Cookie 后每段
/// 420/441/456… 共 3930 条，与 list.so 全量一致。
pub(crate) async fn fetch_segment(
    aid: u64,
    cid: u64,
    segment_index: u64,
    cookie: &str,
) -> Result<Vec<DanmakuElem>, String> {
    let direct_params = vec![
        ("type".to_string(), "1".to_string()),
        ("oid".to_string(), cid.to_string()),
        ("pid".to_string(), aid.to_string()),
        ("segment_index".to_string(), segment_index.to_string()),
    ];

    let direct_error = match request_seg(SEG_URL, &direct_params, cookie).await {
        Ok(bytes) if is_protobuf(&bytes) => return parse_seg(&bytes),
        Ok(bytes) => format!("直连返回非弹幕数据：{}", response_preview(&bytes)),
        Err(error) => error,
    };

    let signed = signed_seg_params(aid, cid, segment_index, cookie).await?;
    let bytes = request_seg(SEG_WBI_URL, &signed, cookie).await?;
    if !is_protobuf(&bytes) {
        return Err(format!(
            "视频弹幕分段返回异常：{direct_error}；WBI 重试：{}",
            response_preview(&bytes)
        ));
    }
    parse_seg(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bvid() {
        let parsed = parse_video_input("BV1Js411o76u").expect("parse");
        assert_eq!(parsed.bvid.as_deref(), Some("BV1Js411o76u"));
        assert_eq!(parsed.aid, None);
    }

    #[test]
    fn parses_av_and_plain_aid() {
        assert_eq!(parse_video_input("av810872").expect("parse").aid, Some(810872));
        assert_eq!(parse_video_input("810872").expect("parse").aid, Some(810872));
        assert_eq!(
            parse_video_input("  AV170001 ").expect("parse").aid,
            Some(170001)
        );
    }

    #[test]
    fn parses_video_urls() {
        let parsed =
            parse_video_input("https://www.bilibili.com/video/BV1Js411o76u/?spm_id_from=333.999")
                .expect("parse");
        assert_eq!(parsed.bvid.as_deref(), Some("BV1Js411o76u"));
        assert_eq!(parsed.page, None);

        let parsed =
            parse_video_input("https://www.bilibili.com/video/BV1Js411o76u?p=2").expect("parse");
        assert_eq!(parsed.page, Some(2));

        let parsed = parse_video_input("https://www.bilibili.com/video/av810872").expect("parse");
        assert_eq!(parsed.aid, Some(810872));
    }

    #[test]
    fn short_link_stays_unresolved() {
        let parsed = parse_video_input("https://b23.tv/abcdefg").expect("parse");
        assert!(!parsed.is_usable());
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_video_input("").is_err());
        assert!(parse_video_input("hello world").is_err());
        assert!(parse_video_input("BV123").is_err());
    }

    #[test]
    fn initial_page_index_clamps() {
        let info = VideoInfo {
            aid: 1,
            bvid: "BV1".into(),
            title: "t".into(),
            duration_ms: 1000,
            requested_page: None,
            pages: vec![
                VideoPage {
                    cid: 10,
                    page: 1,
                    part: "P1".into(),
                    duration_ms: 500,
                },
                VideoPage {
                    cid: 11,
                    page: 2,
                    part: "P2".into(),
                    duration_ms: 500,
                },
            ],
        };
        assert_eq!(info.initial_page_index(None), 0);
        assert_eq!(info.initial_page_index(Some(2)), 1);
        assert_eq!(info.initial_page_index(Some(9)), 1);
        assert_eq!(info.initial_page_index(Some(0)), 0);
    }
}
