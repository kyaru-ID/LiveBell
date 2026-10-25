//! B 站视频弹幕分段接口（`/x/v2/dm/web/seg.so`）的极简 protobuf 解析。
//!
//! 只需要 DmSegMobileReply -> DanmakuElem 这一条消息链，自己写十几行解析比拉
//! prost 依赖更划算（Cargo.toml 里目前没有 protobuf 依赖，也不想为这个功能引入）。
//!
//! 线上结构（bilibili-API-collect / 官方 proto）：
//! ```proto
//! message DmSegMobileReply { repeated DanmakuElem elems = 1; }
//! message DanmakuElem {
//!   int64  id       = 1;
//!   int32  progress = 2;  // 毫秒，相对视频开头
//!   int32  mode     = 3;  // 1-3 滚动 4 底部 5 顶部 6 逆向 7 高级 8 代码 9 BAS
//!   int32  fontsize = 4;
//!   uint32 color    = 5;
//!   string midHash  = 6;
//!   string content  = 7;
//!   int64  ctime    = 8;
//!   int32  weight   = 9;
//!   ...
//! }
//! ```

/// 单条视频弹幕。只保留 LiveBell 用得上的字段。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DanmakuElem {
    /// 弹幕 id（dmid），在同一个视频内唯一，直接拿来当 LiveMessage.id。
    pub(crate) id: u64,
    /// 出现在视频时间轴上的毫秒数。
    pub(crate) progress_ms: u64,
    /// 1-3 滚动 / 4 底部 / 5 顶部 / 6 逆向 / 7 高级 / 8 代码 / 9 BAS。
    pub(crate) mode: u32,
    pub(crate) font_size: u32,
    pub(crate) color: u32,
    /// 发送者 uid 的哈希（视频弹幕不提供真实 uid）。
    pub(crate) mid_hash: String,
    pub(crate) content: String,
    pub(crate) ctime: u64,
    pub(crate) weight: u32,
}

impl DanmakuElem {
    /// 纯文本弹幕层只渲染「有内容、且是普通滚动/顶部/底部」的弹幕。
    ///
    /// 高级弹幕（7）、代码弹幕（8）、BAS 弹幕（9）在这里没有渲染能力，直接丢弃；
    /// 逆向弹幕（6）很少见，按丢弃处理避免出现看不懂的排版。
    pub(crate) fn is_renderable(&self) -> bool {
        !self.content.trim().is_empty() && (1..=5).contains(&self.mode)
    }
}

fn read_varint(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    let mut value: u64 = 0;
    let mut shift = 0u32;
    loop {
        let byte = *bytes
            .get(*cursor)
            .ok_or_else(|| "protobuf: unexpected end of input while reading varint".to_string())?;
        *cursor += 1;
        value |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
        shift += 7;
        if shift >= 64 {
            return Err("protobuf: varint overflow".to_string());
        }
    }
}

fn read_bytes<'a>(bytes: &'a [u8], cursor: &mut usize) -> Result<&'a [u8], String> {
    let length = read_varint(bytes, cursor)? as usize;
    let end = cursor
        .checked_add(length)
        .ok_or_else(|| "protobuf: length overflow".to_string())?;
    let slice = bytes
        .get(*cursor..end)
        .ok_or_else(|| "protobuf: length-delimited field runs past end of input".to_string())?;
    *cursor = end;
    Ok(slice)
}

fn skip_field(bytes: &[u8], cursor: &mut usize, wire_type: u64) -> Result<(), String> {
    match wire_type {
        // varint
        0 => {
            read_varint(bytes, cursor)?;
        }
        // fixed64
        1 => {
            *cursor = cursor
                .checked_add(8)
                .filter(|end| *end <= bytes.len())
                .ok_or_else(|| "protobuf: truncated fixed64 field".to_string())?;
        }
        // length-delimited
        2 => {
            read_bytes(bytes, cursor)?;
        }
        // fixed32
        5 => {
            *cursor = cursor
                .checked_add(4)
                .filter(|end| *end <= bytes.len())
                .ok_or_else(|| "protobuf: truncated fixed32 field".to_string())?;
        }
        other => return Err(format!("protobuf: unsupported wire type {other}")),
    }
    Ok(())
}

fn parse_elem(bytes: &[u8]) -> Result<DanmakuElem, String> {
    let mut elem = DanmakuElem {
        id: 0,
        progress_ms: 0,
        mode: 0,
        font_size: 0,
        color: 0,
        mid_hash: String::new(),
        content: String::new(),
        ctime: 0,
        weight: 0,
    };
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        let tag = read_varint(bytes, &mut cursor)?;
        let field = tag >> 3;
        let wire_type = tag & 0x7;
        match (field, wire_type) {
            (1, 0) => elem.id = read_varint(bytes, &mut cursor)?,
            (2, 0) => elem.progress_ms = read_varint(bytes, &mut cursor)?.min(i32::MAX as u64),
            (3, 0) => elem.mode = read_varint(bytes, &mut cursor)? as u32,
            (4, 0) => elem.font_size = read_varint(bytes, &mut cursor)? as u32,
            (5, 0) => elem.color = read_varint(bytes, &mut cursor)? as u32,
            (6, 2) => {
                elem.mid_hash = String::from_utf8_lossy(read_bytes(bytes, &mut cursor)?).into_owned()
            }
            (7, 2) => {
                elem.content = String::from_utf8_lossy(read_bytes(bytes, &mut cursor)?).into_owned()
            }
            (8, 0) => elem.ctime = read_varint(bytes, &mut cursor)?,
            (9, 0) => elem.weight = read_varint(bytes, &mut cursor)? as u32,
            (_, wire) => skip_field(bytes, &mut cursor, wire)?,
        }
    }
    Ok(elem)
}

/// 解析一段 seg.so 响应体，返回全部 DanmakuElem（含不可渲染的，由调用方过滤）。
pub(crate) fn parse_seg(bytes: &[u8]) -> Result<Vec<DanmakuElem>, String> {
    let mut elems = Vec::new();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        let tag = read_varint(bytes, &mut cursor)?;
        let field = tag >> 3;
        let wire_type = tag & 0x7;
        match (field, wire_type) {
            (1, 2) => elems.push(parse_elem(read_bytes(bytes, &mut cursor)?)?),
            (_, wire) => skip_field(bytes, &mut cursor, wire)?,
        }
    }
    Ok(elems)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn varint(mut value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return out;
            }
            out.push(byte | 0x80);
        }
    }

    fn field_varint(number: u64, value: u64) -> Vec<u8> {
        let mut out = varint((number << 3) | 0);
        out.extend(varint(value));
        out
    }

    fn field_bytes(number: u64, value: &[u8]) -> Vec<u8> {
        let mut out = varint((number << 3) | 2);
        out.extend(varint(value.len() as u64));
        out.extend_from_slice(value);
        out
    }

    fn elem_bytes(id: u64, progress: u64, mode: u64, content: &str, mid: &str) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(field_varint(1, id));
        out.extend(field_varint(2, progress));
        out.extend(field_varint(3, mode));
        out.extend(field_varint(4, 25));
        out.extend(field_varint(5, 0xff9966));
        out.extend(field_bytes(6, mid.as_bytes()));
        out.extend(field_bytes(7, content.as_bytes()));
        out.extend(field_varint(8, 1_700_000_000));
        out.extend(field_varint(9, 5));
        out
    }

    #[test]
    fn parses_reply_with_two_elems() {
        let mut body = Vec::new();
        body.extend(field_bytes(1, &elem_bytes(11, 1_500, 1, "前方高能", "abc123")));
        body.extend(field_bytes(1, &elem_bytes(12, 9_000, 5, "顶部弹幕", "def456")));
        let elems = parse_seg(&body).expect("parse ok");
        assert_eq!(elems.len(), 2);
        assert_eq!(elems[0].id, 11);
        assert_eq!(elems[0].progress_ms, 1_500);
        assert_eq!(elems[0].mode, 1);
        assert_eq!(elems[0].content, "前方高能");
        assert_eq!(elems[0].mid_hash, "abc123");
        assert_eq!(elems[0].color, 0xff9966);
        assert_eq!(elems[1].id, 12);
        assert_eq!(elems[1].mode, 5);
    }

    #[test]
    fn skips_unknown_fields() {
        let mut body = Vec::new();
        body.extend(field_varint(1, 7));
        body.extend(field_varint(99, 42));
        body.extend(field_bytes(1, &elem_bytes(1, 100, 1, "hi", "m")));
        let elems = parse_seg(&body).expect("parse ok");
        assert_eq!(elems.len(), 1);
        assert_eq!(elems[0].content, "hi");
    }

    #[test]
    fn rejects_truncated_input() {
        let body = vec![0x0a, 0x20, 0x00];
        assert!(parse_seg(&body).is_err());
    }

    #[test]
    fn renderable_filter() {
        let base = DanmakuElem {
            id: 1,
            progress_ms: 0,
            mode: 1,
            font_size: 25,
            color: 0,
            mid_hash: String::new(),
            content: "x".into(),
            ctime: 0,
            weight: 0,
        };
        assert!(base.is_renderable());
        assert!(!DanmakuElem { mode: 7, ..base.clone() }.is_renderable());
        assert!(!DanmakuElem { mode: 0, ..base.clone() }.is_renderable());
        assert!(!DanmakuElem { content: "   ".into(), ..base }.is_renderable());
    }

    #[test]
    fn empty_body_is_empty_vec() {
        assert!(parse_seg(&[]).expect("parse ok").is_empty());
    }
}
