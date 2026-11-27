import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useVideoDanmaku } from "./useVideoDanmaku";
import type { VideoDanmakuSnapshot } from "../types/videoDanmaku";

const { listeners, invoke } = vi.hoisted(() => ({ listeners: new Map<string, (event: { payload: unknown }) => void>(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (event: string, callback: (event: { payload: unknown }) => void) => {
  listeners.set(event, callback); return () => listeners.delete(event);
}) }));
afterEach(() => { listeners.clear(); vi.clearAllMocks(); });
const snapshot = (sessionId: string): VideoDanmakuSnapshot => ({ sessionId, aid: 1, bvid: "BV", title: "视频", cid: 1, pageIndex: 0, pageTitle: "分P", durationMs: 60000, positionMs: 0, playing: true, rate: 1, looping: false, finished: false, loading: false, pages: [] });

test("切换视频后清除旧进度并忽略旧会话迟到事件", async () => {
  invoke.mockResolvedValue(null);
  const { result } = renderHook(() => useVideoDanmaku(true));
  await waitFor(() => expect(invoke).toHaveBeenCalled());
  act(() => {
    listeners.get("video-danmaku-changed")!({ payload: snapshot("video:1:1") });
    listeners.get("video-danmaku-progress")!({ payload: { ...snapshot("video:1:1"), positionMs: 30000 } });
  });
  expect(result.current.progress?.positionMs).toBe(30000);
  act(() => {
    listeners.get("video-danmaku-changed")!({ payload: snapshot("video:2:2") });
    listeners.get("video-danmaku-progress")!({ payload: { ...snapshot("video:1:1"), positionMs: 31000 } });
  });
  expect(result.current.snapshot?.sessionId).toBe("video:2:2");
  expect(result.current.progress).toBeNull();
});
