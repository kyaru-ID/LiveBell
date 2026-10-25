import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  VideoDanmakuControl,
  VideoDanmakuProgress,
  VideoDanmakuSnapshot,
} from "../types/videoDanmaku";

const CHANGED_EVENT = "video-danmaku-changed";
const PROGRESS_EVENT = "video-danmaku-progress";

/**
 * 视频弹幕会话：后端每 200ms 推一次进度，切换/关闭时推完整快照。
 * 弹幕本身仍然走 danmaku-messages，跟直播间弹幕共用同一条渲染管线。
 */
export function useVideoDanmaku(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<VideoDanmakuSnapshot | null>(null);
  const [progress, setProgress] = useState<VideoDanmakuProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 每次拖动进度条 +1，弹幕层据此清掉旧时间点的弹幕。
  const [seekToken, setSeekToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;
    const unlistenChanged = listen<VideoDanmakuSnapshot | null>(
      CHANGED_EVENT,
      (event) => {
        if (disposed) {
          return;
        }
        const next = event.payload ?? null;
        setSnapshot(next);
        if (!next) {
          setProgress(null);
        }
      },
    );
    let lastPositionMs: number | null = null;
    const unlistenProgress = listen<VideoDanmakuProgress>(
      PROGRESS_EVENT,
      (event) => {
        if (disposed) {
          return;
        }
        const next = event.payload;
        // 正常播放 200ms 才前进 200ms，一次跳超过 1.5 秒只可能是拖动进度条。
        if (
          lastPositionMs !== null &&
          Math.abs(next.positionMs - lastPositionMs) > 1500
        ) {
          setSeekToken((token) => token + 1);
        }
        lastPositionMs = next.positionMs;
        setProgress(next);
      },
    );

    // 窗口重新加载（比如换主题触发重载）时把已有会话捞回来。
    void (async () => {
      try {
        const current = await invoke<VideoDanmakuSnapshot | null>(
          "get_video_danmaku_state",
        );
        if (!disposed && current) {
          setSnapshot(current);
        }
      } catch {
        // 启动时没有视频会话是最常见的情况，不需要提示。
      }
    })();

    return () => {
      disposed = true;
      void unlistenChanged.then((unlisten) => unlisten());
      void unlistenProgress.then((unlisten) => unlisten());
    };
  }, [enabled]);

  const control = useCallback(async (command: VideoDanmakuControl) => {
    try {
      const next = await invoke<VideoDanmakuSnapshot>(
        "video_danmaku_control",
        { command },
      );
      setSnapshot(next);
      setError(null);
      return next;
    } catch (controlError) {
      setError(String(controlError));
      return null;
    }
  }, []);

  const close = useCallback(async () => {
    try {
      await invoke("close_video_danmaku");
    } catch {
      // 已经关掉了就忽略。
    }
    setSnapshot(null);
    setProgress(null);
  }, []);

  return { close, control, error, progress, seekToken, snapshot };
}
