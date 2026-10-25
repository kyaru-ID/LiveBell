import { useCallback, useEffect, useRef, useState } from "react";

/** 后端进度追上本地拖动值之前，先用本地值渲染，避免 thumb 在 pointerup 后弹回旧位置。 */
const PENDING_SETTLE_MS = 1_200;
const PENDING_TIMEOUT_MS = 1_500;

type UseVideoSeekDragOptions = {
  durationMs: number;
  liveMs: number;
  onSeek: (positionMs: number) => void;
};

export type VideoSeekDrag = {
  /** 当前应该显示的位置：拖动中显示本地值，否则显示后端值（过渡期用刚提交的拖动值）。 */
  positionMs: number;
  dragging: boolean;
  beginDrag: (currentMs: number) => void;
  updateDrag: (nextMs: number) => void;
  finishDrag: () => void;
  commitSeek: (nextMs: number) => void;
  handleDragChange: (nextMs: number) => void;
};

/**
 * 视频进度条的拖动状态机（弹幕层底部那条与主界面那条共用）：
 * 按下时冻结本地值 -> 拖动中只更新本地值 -> 松手提交 seek ->
 * 等后端 progress 追上（或 1.5 秒超时）才交还控制权，否则 thumb 会弹回旧位置。
 */
export function useVideoSeekDrag({
  durationMs,
  liveMs,
  onSeek,
}: UseVideoSeekDragOptions): VideoSeekDrag {
  const [dragging, setDragging] = useState(false);
  const [dragMs, setDragMs] = useState(0);
  const [pendingSeekMs, setPendingSeekMs] = useState<number | null>(null);
  // 指针事件与 change 可能同批到达，用 ref 保证提交的是最新值、且只提交一次。
  const dragMsRef = useRef(0);
  const draggingRef = useRef(false);
  const onSeekRef = useRef(onSeek);

  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);

  const clampedLive = Math.min(liveMs, durationMs || liveMs);
  const positionMs = dragging ? dragMs : (pendingSeekMs ?? clampedLive);

  const commitSeek = useCallback((next: number) => {
    draggingRef.current = false;
    setDragging(false);
    setPendingSeekMs(next);
    onSeekRef.current(next);
  }, []);

  const beginDrag = useCallback((currentMs: number) => {
    dragMsRef.current = currentMs;
    draggingRef.current = true;
    setDragMs(currentMs);
    setPendingSeekMs(null);
    setDragging(true);
  }, []);

  const updateDrag = useCallback((next: number) => {
    dragMsRef.current = next;
    setDragMs(next);
  }, []);

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) {
      return;
    }
    commitSeek(dragMsRef.current);
  }, [commitSeek]);

  const handleDragChange = useCallback(
    (next: number) => {
      if (draggingRef.current) {
        updateDrag(next);
        return;
      }
      commitSeek(next);
    },
    [commitSeek, updateDrag],
  );

  // 指针在进度条外松开时 input 收不到 pointerup，这里兜一层，避免拖动状态卡住。
  useEffect(() => {
    if (!dragging) {
      return;
    }
    function handlePointerEnd() {
      finishDrag();
    }
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [dragging, finishDrag]);

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

  return {
    beginDrag,
    commitSeek,
    dragging,
    finishDrag,
    handleDragChange,
    positionMs,
    updateDrag,
  };
}
