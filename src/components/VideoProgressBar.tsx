import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat, X } from "lucide-react";
import type {
  VideoDanmakuControl,
  VideoDanmakuProgress,
  VideoDanmakuSnapshot,
} from "../types/videoDanmaku";

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** 后端进度追上本地拖动值之前，先用本地值渲染，避免 thumb 在 pointerup 后弹回旧位置。 */
const PENDING_SETTLE_MS = 1_200;
const PENDING_TIMEOUT_MS = 1_500;

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minuteText =
    hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const secondText = String(seconds).padStart(2, "0");
  return (hours > 0 ? hours + ":" : "") + minuteText + ":" + secondText;
}

type VideoProgressBarProps = {
  snapshot: VideoDanmakuSnapshot;
  progress: VideoDanmakuProgress | null;
  onControl: (command: VideoDanmakuControl) => void | Promise<unknown>;
  onClose: () => void | Promise<void>;
};

const controlButtonClass =
  "grid size-7 shrink-0 place-items-center rounded-full border border-[var(--drift-ui-line)] text-[var(--drift-ui-ink)] transition hover:bg-[var(--drift-ui-hover)] disabled:opacity-40";

const selectClass =
  "h-7 shrink-0 rounded-md border border-[var(--drift-ui-line)] bg-[var(--drift-ui-surface)] px-1.5 text-[11px] text-[var(--drift-ui-ink)] outline-none";

/**
 * 视频弹幕进度条，只在编辑模式显示。
 * 弹幕层平时整窗鼠标穿透，编辑模式下整窗可点，所以放在这里既能操作又不会挡住后面的直播页。
 * 位置：编辑工作台底栏（.overlay-control-dock，bottom 8px + 高 32px）正上方单独一栏，
 * 通栏（左右各 12px）、高 36px；有进度条时 Mock 面板整体上移到它上面（.overlay-mock-panel.is-raised）。
 */
export function VideoProgressBar({
  onClose,
  onControl,
  progress,
  snapshot,
}: VideoProgressBarProps) {
  const [dragging, setDragging] = useState(false);
  const [dragMs, setDragMs] = useState(0);
  const [pendingSeekMs, setPendingSeekMs] = useState<number | null>(null);
  // pointerup 与最后一次 change 可能同批触发，用 ref 保证提交的是最新拖动值。
  const dragMsRef = useRef(0);

  const sameSession = progress?.sessionId === snapshot.sessionId;
  const durationMs = snapshot.durationMs || 0;
  const liveMs = sameSession ? progress.positionMs : snapshot.positionMs;
  const playing = sameSession ? progress.playing : snapshot.playing;
  const loading = sameSession ? progress.loading : snapshot.loading;
  const positionMs = dragging
    ? dragMs
    : (pendingSeekMs ?? Math.min(liveMs, durationMs || liveMs));

  const pageLabel =
    snapshot.pageTitle && snapshot.pageTitle !== snapshot.title
      ? snapshot.pageTitle
      : "";

  const commitSeek = useCallback(
    (next: number) => {
      setDragging(false);
      setPendingSeekMs(next);
      void onControl({ action: "seek", positionMs: next });
    },
    [onControl],
  );

  function beginDrag() {
    dragMsRef.current = positionMs;
    setDragMs(positionMs);
    setPendingSeekMs(null);
    setDragging(true);
  }

  function finishDrag() {
    if (!dragging) {
      return;
    }
    commitSeek(dragMsRef.current);
  }

  // 指针在进度条外松开时 input 收不到 pointerup，这里兜一层，避免拖动状态卡住。
  useEffect(() => {
    if (!dragging) {
      return;
    }
    function handlePointerEnd() {
      commitSeek(dragMsRef.current);
    }
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [dragging, commitSeek]);

  // 后端进度追上本地值（或超时）后放弃本地拖动值，之后完全跟后端走。
  useEffect(() => {
    if (pendingSeekMs === null) {
      return;
    }
    if (Math.abs(liveMs - pendingSeekMs) < PENDING_SETTLE_MS) {
      setPendingSeekMs(null);
      return;
    }
    const timer = window.setTimeout(
      () => setPendingSeekMs(null),
      PENDING_TIMEOUT_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [liveMs, pendingSeekMs]);

  return (
    <section
      aria-label="视频弹幕进度"
      className="video-progress-bar pointer-events-auto absolute inset-x-3 bottom-[2.875rem] z-20 flex h-9 items-center gap-2 rounded-[10px] border border-[var(--drift-ui-line)] bg-[var(--drift-ui-raised)] px-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
      title={
        snapshot.title +
        (pageLabel ? " · " + pageLabel : "") +
        "（" +
        snapshot.bvid +
        "）"
      }
    >
      <button
        aria-label={playing ? "暂停" : "播放"}
        className={controlButtonClass}
        onClick={() =>
          void onControl({ action: playing ? "pause" : "play" })
        }
        type="button"
      >
        {playing ? (
          <Pause aria-hidden="true" size={13} />
        ) : (
          <Play aria-hidden="true" size={13} />
        )}
      </button>

      <span className="drift-data-text shrink-0 text-[11px] tabular-nums text-[var(--drift-ui-ink)]">
        {formatTime(positionMs)}
      </span>

      <input
        aria-label="视频进度"
        className="h-1.5 min-w-0 flex-1 cursor-pointer"
        max={durationMs || 1}
        min={0}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (dragging) {
            dragMsRef.current = next;
            setDragMs(next);
          } else {
            commitSeek(next);
          }
        }}
        onPointerCancel={finishDrag}
        onPointerDown={beginDrag}
        onPointerUp={finishDrag}
        style={{ accentColor: "#fb7299" }}
        type="range"
        value={Math.min(positionMs, durationMs || positionMs)}
      />

      <span className="drift-data-text shrink-0 text-[11px] tabular-nums text-[var(--drift-ui-ink-soft)]">
        {formatTime(durationMs)}
      </span>

      {loading ? (
        <span className="shrink-0 text-[10px] text-[var(--drift-ui-muted)]">
          加载中…
        </span>
      ) : null}

      {snapshot.error ? (
        <span
          className="max-w-[180px] shrink-0 truncate text-[10px] text-[var(--drift-ui-danger)]"
          role="alert"
          title={snapshot.error}
        >
          {snapshot.error}
        </span>
      ) : null}

      <select
        aria-label="播放倍速"
        className={selectClass}
        onChange={(event) =>
          void onControl({
            action: "setRate",
            rate: Number(event.currentTarget.value),
          })
        }
        value={String(snapshot.rate)}
      >
        {RATE_OPTIONS.map((rate) => (
          <option key={rate} value={String(rate)}>
            {rate + "x"}
          </option>
        ))}
      </select>

      <button
        aria-label={snapshot.looping ? "关闭循环播放" : "循环播放"}
        aria-pressed={snapshot.looping}
        className={[
          controlButtonClass,
          snapshot.looping
            ? "border-[#fb7299] text-[#fb7299]"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() =>
          void onControl({ action: "setLooping", looping: !snapshot.looping })
        }
        type="button"
      >
        <Repeat aria-hidden="true" size={13} />
      </button>

      {snapshot.pages.length > 1 ? (
        <select
          aria-label="分P"
          className={selectClass + " max-w-[170px]"}
          onChange={(event) =>
            void onControl({
              action: "selectPage",
              index: Number(event.currentTarget.value),
            })
          }
          value={String(snapshot.pageIndex)}
        >
          {snapshot.pages.map((page) => (
            <option key={page.index} value={String(page.index)}>
              {"P" + page.page + " " + page.part}
            </option>
          ))}
        </select>
      ) : null}

      <button
        aria-label="关闭视频弹幕"
        className={controlButtonClass}
        onClick={() => void onClose()}
        type="button"
      >
        <X aria-hidden="true" size={13} />
      </button>
    </section>
  );
}
