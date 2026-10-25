import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat, X } from "lucide-react";
import { Button } from "../ui";
import type {
  VideoDanmakuControl,
  VideoDanmakuProgress,
  VideoDanmakuSnapshot,
} from "../../types/videoDanmaku";
import { formatTime, parseTimeInput } from "../videoTimeInput";
import { useVideoSeekDrag } from "../../hooks/useVideoSeekDrag";

const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const SELECT_CLASS =
  "h-7 shrink-0 rounded-md border border-[var(--drift-ui-line)] bg-[var(--drift-ui-surface)] px-1.5 text-[11px] text-[var(--drift-ui-ink-soft)] outline-none";

type HomeVideoControlProps = {
  snapshot: VideoDanmakuSnapshot;
  progress: VideoDanmakuProgress | null;
  onControl: (command: VideoDanmakuControl) => void | Promise<unknown>;
  onClose: () => void | Promise<void>;
};

/**
 * 主界面「视频弹幕」区连上以后追加的控制块（两行）：
 * 第一行是标题 / 分P / 断开，第二行是播放暂停、时间、进度条、倍速、循环、分P。
 * 能力与弹幕层底部那条一致，只是走普通文档流、视觉对齐下面临时连接的房间行。
 */
export function HomeVideoControl({
  onClose,
  onControl,
  progress,
  snapshot,
}: HomeVideoControlProps) {
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
  const pageLabel =
    snapshot.pageTitle && snapshot.pageTitle !== snapshot.title
      ? snapshot.pageTitle
      : "";

  const handleSeek = useCallback(
    (positionMs: number) => {
      void onControl({ action: "seek", positionMs });
    },
    [onControl],
  );
  // 和弹幕层那条共用同一套拖动 / 防回弹逻辑。
  const { beginDrag, commitSeek, finishDrag, handleDragChange, positionMs } =
    useVideoSeekDrag({ durationMs, liveMs, onSeek: handleSeek });

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
      className="drift-theme-transition mt-2 grid gap-1.5 rounded-lg border border-[var(--drift-ui-line)] bg-[var(--drift-ui-surface)] px-3 py-2"
      title={
        snapshot.title + (pageLabel ? " · " + pageLabel : "") + "（" + snapshot.bvid + "）"
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-[#00aeec]"
        />
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--drift-ui-ink)]">
          {snapshot.title}
          {pageLabel ? (
            <span className="text-[var(--drift-ui-muted)]">
              {" · " + pageLabel}
            </span>
          ) : null}
        </span>
        {loading ? (
          <span className="shrink-0 text-[10px] text-[var(--drift-ui-muted)]">
            加载中…
          </span>
        ) : null}
        {snapshot.error ? (
          <span
            className="max-w-[160px] shrink-0 truncate text-[10px] text-[var(--drift-ui-danger)]"
            role="alert"
            title={snapshot.error}
          >
            {snapshot.error}
          </span>
        ) : null}
        <Button
          aria-label="断开视频弹幕"
          className="shrink-0"
          onClick={() => void onClose()}
          size="sm"
          variant="ghost"
        >
          <X aria-hidden="true" size={13} />
          断开
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          aria-label={playing ? "暂停" : "播放"}
          className="shrink-0 px-1.5"
          onClick={() =>
            void onControl({ action: playing ? "pause" : "play" })
          }
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
            className="h-4 w-[3.25rem] shrink-0 bg-transparent p-0 text-center text-[11px] tabular-nums text-[var(--drift-ui-ink-soft)] outline-none"
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
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[11px] tabular-nums text-[var(--drift-ui-ink-soft)] outline-none"
            onClick={beginTimeEdit}
            title="点击修改播放时间"
            type="button"
          >
            {formatTime(positionMs)}
          </button>
        )}

        <input
          aria-label="视频进度"
          className="h-1.5 min-w-[120px] flex-1 cursor-pointer"
          max={durationMs || 1}
          min={0}
          onChange={(event) =>
            handleDragChange(Number(event.currentTarget.value))
          }
          onPointerCancel={finishDrag}
          onPointerDown={() => beginDrag(positionMs)}
          onPointerUp={finishDrag}
          style={{ accentColor: "#fb7299" }}
          type="range"
          value={Math.min(positionMs, durationMs || positionMs)}
        />

        <span className="shrink-0 text-[11px] tabular-nums text-[var(--drift-ui-ink-soft)]">
          {formatTime(durationMs)}
        </span>

        <select
          aria-label="播放倍速"
          className={SELECT_CLASS}
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
          className={
            "shrink-0 px-1.5" +
            (snapshot.looping
              ? " !text-[var(--drift-ui-signal-text)]"
              : "")
          }
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
            className={SELECT_CLASS + " max-w-[150px]"}
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
      </div>
    </section>
  );
}
