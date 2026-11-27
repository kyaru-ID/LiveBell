//! 可独立测试的播放状态机：下载、时间轴消费与批次发送分别推进。
use super::*;
use std::time::Instant;

const MAX_CACHED_SEGMENTS: usize = 8;
const CACHE_BUDGET_BYTES: usize = 32 * 1024 * 1024;
pub(super) type FetchJob = (String, u64, u64, u64, String);

pub(super) struct SegmentFailure {
    error: String,
    attempts: u32,
    retry_at: Instant,
}

pub(super) fn record_failure(session: &mut VideoSession, index: u64, error: String, now: Instant) {
    let attempts = session
        .failed
        .get(&index)
        .map_or(1, |failure| failure.attempts.saturating_add(1));
    let delay = Duration::from_secs((1u64 << attempts.saturating_sub(1).min(5)).min(30));
    session.failed.insert(
        index,
        SegmentFailure {
            error: error.clone(),
            attempts,
            retry_at: now + delay,
        },
    );
    if index == session.segment_of(session.position_ms) {
        session.error = Some(error);
    }
}

fn segments_for(session: &VideoSession, from: u64, to: u64) -> std::ops::RangeInclusive<u64> {
    session.segment_of(from)..=session.segment_of(to.saturating_sub(1).max(from))
}

fn range_ready(session: &VideoSession, from: u64, to: u64) -> bool {
    from >= to || segments_for(session, from, to).all(|index| session.segments.contains_key(&index))
}

fn queue_range(session: &mut VideoSession, from: u64, to: u64) {
    if from >= to {
        return;
    }
    for index in segments_for(session, from, to) {
        if let Some(items) = session.segments.get(&index) {
            let first = items.partition_point(|elem| elem.progress_ms < from);
            let last = items.partition_point(|elem| elem.progress_ms < to);
            session.pending.extend(
                items[first..last]
                    .iter()
                    .map(|elem| to_live_message(session.cid, elem)),
            );
        }
    }
}

pub(super) fn prune_cache(session: &mut VideoSession) {
    let current = session.segment_of(session.position_ms);
    let mut pinned = HashSet::from([current, current + 1]);
    if let Some((from, to)) = session.backfill {
        pinned.extend(segments_for(session, from, to));
    }
    let mut candidates: Vec<u64> = session
        .segments
        .keys()
        .copied()
        .filter(|index| !pinned.contains(index))
        .collect();
    candidates.sort_by_key(|index| std::cmp::Reverse(index.abs_diff(current)));
    let mut bytes: usize = session
        .segments
        .values()
        .flatten()
        .map(|elem| {
            std::mem::size_of::<DanmakuElem>() + elem.content.capacity() + elem.mid_hash.capacity()
        })
        .sum();
    for index in candidates {
        if session.segments.len() <= MAX_CACHED_SEGMENTS && bytes <= CACHE_BUDGET_BYTES {
            break;
        }
        if let Some(items) = session.segments.remove(&index) {
            bytes = bytes.saturating_sub(
                items
                    .iter()
                    .map(|elem| {
                        std::mem::size_of::<DanmakuElem>()
                            + elem.content.capacity()
                            + elem.mid_hash.capacity()
                    })
                    .sum::<usize>(),
            );
        }
    }
}

pub(super) fn step(
    session: &mut VideoSession,
    elapsed_ms: f64,
    now: Instant,
) -> (Vec<FetchJob>, Vec<LiveMessage>) {
    let mut wanted = HashSet::new();
    let current = session.segment_of(session.position_ms);
    wanted.insert(current);
    if current < session.segment_count()
        && session.position_ms + PREFETCH_AHEAD_MS >= current * SEGMENT_MS
    {
        wanted.insert(current + 1);
    }

    // 回填区间全部可用时只入队一次，避免已就绪的半段被反复发送。
    let mut waiting_backfill = false;
    if let Some((from, to)) = session.backfill {
        if range_ready(session, from, to) {
            queue_range(session, from, to);
            session.backfill = None;
        } else {
            wanted.extend(segments_for(session, from, to));
            waiting_backfill = true;
        }
    }

    if session.playing
        && !session.finished
        && !waiting_backfill
        && session.segments.contains_key(&current)
    {
        let target = session
            .position_ms
            .saturating_add(advance_step(elapsed_ms, session.rate))
            .min(session.duration_ms);
        let mut available_to = target;
        // 跨分段时不能越过尚未下载的区间，否则该段前几条弹幕会永久被跳过。
        for index in segments_for(session, session.position_ms, target) {
            if !session.segments.contains_key(&index) {
                wanted.insert(index);
                available_to = ((index - 1) * SEGMENT_MS).max(session.position_ms);
                break;
            }
        }
        session.position_ms = available_to;
        queue_range(session, session.last_emit_ms, available_to);
        session.last_emit_ms = available_to;
        if available_to >= session.duration_ms {
            session.finished = true;
            if !session.looping {
                session.playing = false;
            }
        }
    }

    let mut jobs = Vec::new();
    let mut wanted: Vec<_> = wanted.into_iter().collect();
    wanted.sort_unstable();
    for index in wanted {
        if index == 0
            || index > session.segment_count()
            || session.segments.contains_key(&index)
            || session.loading.contains(&index)
        {
            continue;
        }
        if session
            .failed
            .get(&index)
            .is_some_and(|failure| now < failure.retry_at)
        {
            continue;
        }
        session.loading.insert(index);
        jobs.push((
            session.session_id.clone(),
            session.aid,
            session.cid,
            index,
            session.cookie.clone(),
        ));
    }
    session.error = session
        .failed
        .get(&session.segment_of(session.position_ms))
        .map(|failure| failure.error.clone());

    // 批次上限只限制吞吐，不丢弃同一毫秒内剩下的消息；片尾也继续排空。
    let messages = session
        .pending
        .drain(..session.pending.len().min(MAX_BATCH_MESSAGES))
        .collect();
    if session.finished && session.looping && session.playing && session.pending.is_empty() {
        session.position_ms = 0;
        session.last_emit_ms = 0;
        session.finished = false;
    }
    (jobs, messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn elem(id: u64, progress_ms: u64) -> DanmakuElem {
        DanmakuElem {
            id,
            progress_ms,
            mode: 1,
            font_size: 25,
            color: 0xffffff,
            mid_hash: String::new(),
            content: "测试".into(),
            ctime: 0,
            weight: 0,
        }
    }
    fn session(duration_ms: u64, position_ms: u64) -> VideoSession {
        VideoSession {
            session_id: "video:1:1".into(),
            aid: 1,
            bvid: String::new(),
            title: String::new(),
            pages: vec![],
            page_index: 0,
            cid: 1,
            duration_ms,
            position_ms,
            playing: true,
            rate: 1.0,
            looping: false,
            finished: false,
            last_emit_ms: position_ms,
            backfill: None,
            segments: HashMap::new(),
            loading: HashSet::new(),
            failed: HashMap::new(),
            error: None,
            cookie: String::new(),
            pending: Default::default(),
        }
    }
    #[test]
    fn ending_tick_and_a_dense_single_timestamp_are_fully_delivered() {
        let mut session = session(1000, 900);
        session
            .segments
            .insert(1, (0..601).map(|id| elem(id, 950)).collect());
        let now = Instant::now();
        let mut messages = step(&mut session, 100.0, now).1;
        assert!(session.finished);
        assert_eq!(messages.len(), 300);
        messages.extend(step(&mut session, 100.0, now).1);
        messages.extend(step(&mut session, 100.0, now).1);
        assert_eq!(messages.len(), 601);
        assert_eq!(
            messages
                .iter()
                .map(|msg| &msg.id)
                .collect::<HashSet<_>>()
                .len(),
            601
        );
    }
    #[test]
    fn incomplete_backfill_waits_then_emits_exactly_once() {
        let mut session = session(720000, 362000);
        session.playing = false;
        session.backfill = Some((358000, 362000));
        session.segments.insert(2, vec![elem(2, 361000)]);
        let now = Instant::now();
        assert!(step(&mut session, 100.0, now).1.is_empty());
        assert!(step(&mut session, 100.0, now).1.is_empty());
        session.segments.insert(1, vec![elem(1, 359000)]);
        assert_eq!(step(&mut session, 100.0, now).1.len(), 2);
        assert!(step(&mut session, 100.0, now).1.is_empty());
    }
    #[test]
    fn missing_next_segment_does_not_skip_its_first_messages() {
        let mut session = session(720000, 359950);
        session.segments.insert(1, vec![elem(1, 359975)]);
        let now = Instant::now();
        assert_eq!(step(&mut session, 100.0, now).1.len(), 1);
        assert_eq!(session.position_ms, 360000);
        session.segments.insert(2, vec![elem(2, 360010)]);
        assert_eq!(step(&mut session, 100.0, now).1.len(), 1);
    }
    #[test]
    fn failed_segments_retry_with_backoff_and_cache_is_bounded() {
        let mut session = session(20 * SEGMENT_MS, 0);
        let now = Instant::now();
        record_failure(&mut session, 1, "临时失败".into(), now);
        assert!(step(&mut session, 100.0, now).0.is_empty());
        assert_eq!(
            step(&mut session, 100.0, now + Duration::from_secs(1))
                .0
                .len(),
            1
        );
        for index in 1..=20 {
            session
                .segments
                .insert(index, vec![elem(index, (index - 1) * SEGMENT_MS)]);
        }
        prune_cache(&mut session);
        assert!(session.segments.len() <= MAX_CACHED_SEGMENTS);
        assert!(session.segments.contains_key(&1));
    }
}
