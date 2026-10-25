import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat, X } from "lucide-react";
import { Button } from "./ui";
import type {
  VideoDanmakuControl,
  VideoDanmakuProgress,
  VideoDanmakuSnapshot,
} from "../types/videoDanmaku";
import { formatTime, parseTimeInput } from "./videoTimeInput";
import { useVideoSeekDrag } from "../hooks/useVideoSeekDrag";

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

type VideoProgressBarProps = {
  snapshot: VideoDanmakuSnapshot;
  progress: VideoDanmakuProgress | null;
  onControl: (command: VideoDanmakuControl) => void | Promise<unknown>;
  onClose: () => void | Promise<void>;
};

// 与编辑工作台底栏（OverlayControlDock）完全一致，两栏看起来是同一套控件。
const DOCK_BUTTON_CLASS =
  "shrink-0 !border-[var(--drift-ui-border)] !bg-[var(--drift-ui-overlay-control)] !text-[var(--drift-ui-ink-soft)] !shadow-none hover:!border-[var(--drift-ui-border-strong)] hover:!bg-[var(--drift-ui-overlay-control-hover)] hover:!text-[var(--drift-ui-ink)] focus-visible:!ring-[color-mix(in_srgb,var(--drift-ui-signal)_25%,transparent)]";

const DOCK_BUTTON_ACTIVE_CLASS =
  "!border-[var(--drift-ui-signal)] !bg-[var(--drift-ui-overlay-selected)] !text-[var(--drift-ui-signal-text)]";

const selectClass =
  "h-7 shrink-0 rounded-md border border-[var(--drift-ui-border)] bg-[var(--drift-ui-overlay-control)] px-1.5 text-[11px] text-[var(--drift-ui-ink-soft)] outline-none";

/**
 * 视频弹幕进度条，只在编辑模式显示。
 * 弹幕层平时整窗鼠标穿透，编辑模式下整窗可点，所以放在这里既能操作又不会挡住后面的直播页。
 * 位置：编辑工作台底栏（.overlay-control-dock，bottom 8px + 高 32px）正上方单独一栏，
 * 通栏（左右各 12px）、高 32px，边框 / 圆角 9px / 玻璃背景 / 18px 模糊 / 阴影全部对齐底栏；
 * 有进度条时 Mock 面板整体上移到它上面（.overlay-mock-panel.is-raised）。
 */
export function VideoProgressBar({
  onClose,
  onControl,
  progress,
  snapshot,
}: VideoProgressBarProps) {
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState("");
  // setEditingTime 是异步的，用 ref 保证回车与随后可能触发的 blur 只提交一次。
  const editingTimeRef = useRef(false);
  const timeInputRef = useRef<HTMLInputElement | null>(null);

  const sameSession = progress?.sessionId === snapshot.sessionId;
  const durationMs = snapshot.durationMs || 0;
  const liveMs = sameSession ? progress.positionMs : snapshot.positionMs;
  const playing = sameSession ? progress.playing : snapshot.playing;
  const loading = sameSession ? progress.loading : snapshot.loading;

  const handleSeek = useCallback(
    (next: number) => {
      void onControl({ action: "seek", positionMs: next });
    },
    [onControl],
  );
  // 拖动 / 提交 / 防回弹的时序都在这个 hook 里，主界面那条共用同一份逻辑。
  const { beginDrag, commitSeek, finishDrag, handleDragChange, positionMs } =
    useVideoSeekDrag({ durationMs, liveMs, onSeek: handleSeek });

  const pageLabel =
    snapshot.pageTitle && snapshot.pageTitle !== snapshot.title
      ? snapshot.pageTitle
      : "";

  function beginTimeEdit() {
    editingTimeRef.current = true;
    setTimeDraft(formatTime(positionMs));
    setEditingTime(true);
  }

  /** 回车 / 点到别处提交，Esc 取消；解析失败按约定退回原值。 */
  function endTimeEdit(commit: boolean) {
    if (!editingTimeRef.current) {
      return;
    }
    editingTimeRef.current = false;
    setEditingTime(false);
    if (!commit) {
      return;
    }
    const parsed = parseTimeInput(timeDraft);
    if (parsed === null) {
      return;
    }
    // 超过总时长按约定跳到片尾。
    commitSeek(durationMs > 0 ? Math.min(parsed, durationMs) : parsed);
  }

  // 进入编辑态后聚焦并全选，直接敲数字就能覆盖原值。
  useEffect(() => {
    if (!editingTime) {
      return;
    }
    const input = timeInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, [editingTime]);

  return (
    <section
      aria-label="视频弹幕进度"
      className="drift-theme-transition video-progress-bar pointer-events-auto absolute inset-x-3 bottom-[2.875rem] z-20 box-border flex h-8 min-w-0 select-none items-center gap-1.5 overflow-hidden rounded-[9px] border border-[var(--drift-ui-border)] bg-[var(--drift-ui-overlay-glass)] px-2 text-[var(--drift-ui-ink)] shadow-[0_10px_30px_var(--drift-ui-overlay-dock-shadow)] backdrop-blur-[18px]"
      title={
        snapshot.title +
        (pageLabel ? " · " + pageLabel : "") +
        "（" +
        snapshot.bvid +
        "）"
      }
    >
      <Button
        aria-label={playing ? "暂停" : "播放"}
        className={DOCK_BUTTON_CLASS}
        onClick={() => void onControl({ action: playing ? "pause" : "play" })}
        size="sm"
        variant="ghost"
      >
        {playing ? (
          <Pause aria-hidden="true" size={13} />
        ) : (
          <Play aria-hidden="true" size={13} />
        )}
      </Button>

      {editingTime ? (
        <input
          aria-label="跳转到时间"
          className="drift-data-text h-4 w-[3.25rem] shrink-0 bg-transparent p-0 text-center text-[11px] tabular-nums text-[var(--drift-ui-ink-soft)] outline-none"
          onBlur={() => endTimeEdit(true)}
          onChange={(event) => setTimeDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              endTimeEdit(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              endTimeEdit(false);
            }
          }}
          ref={timeInputRef}
          value={timeDraft}
        />
      ) : (
        <button
          aria-label="修改播放时间"
          className="drift-data-text shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] tabular-nums text-[var(--drift-ui-ink-soft)] outline-none"
          onClick={beginTimeEdit}
          title="点击修改播放时间"
          type="button"
        >
          {formatTime(positionMs)}
        </button>
      )}

      <input
        aria-label="视频进度"
        className="h-1.5 min-w-0 flex-1 cursor-pointer"
        max={durationMs || 1}
        min={0}
        onChange={(event) => handleDragChange(Number(event.currentTarget.value))}
        onPointerCancel={finishDrag}
        onPointerDown={() => beginDrag(positionMs)}
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

      <Button
        aria-label={snapshot.looping ? "关闭循环播放" : "循环播放"}
        aria-pressed={snapshot.looping}
        className={[
          DOCK_BUTTON_CLASS,
          snapshot.looping ? DOCK_BUTTON_ACTIVE_CLASS : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() =>
          void onControl({ action: "setLooping", looping: !snapshot.looping })
        }
        size="sm"
        variant="ghost"
      >
        <Repeat aria-hidden="true" size={13} />
      </Button>

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

      <Button
        aria-label="关闭视频弹幕"
        className={DOCK_BUTTON_CLASS}
        onClick={() => void onClose()}
        size="sm"
        variant="ghost"
      >
        <X aria-hidden="true" size={13} />
      </Button>
    </section>
  );
}
