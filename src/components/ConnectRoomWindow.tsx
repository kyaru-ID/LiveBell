import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStreamerSearch } from "../hooks/useStreamerSearch";
import {
  STREAMER_NOT_FOUND_HINT,
  type StreamerCandidate,
} from "../types/streamer";
import { roomIdFromInput } from "../utils/roomId";
import { Button, Input } from "./ui";
import { StatusBanner } from "./control/settings-ui";
import { StreamerCandidateList } from "./StreamerCandidateList";

// 敲字后延迟这么久才查询房间状态，避免每敲一字打一次接口（对齐 C# 的 450ms 防抖）。
const STATUS_DEBOUNCE_MS = 450;

type LiveRoomCheck = {
  isLive: boolean;
  roomId: string;
  title: string;
};

/**
 * 「连接房间」独立窗口：输入房间号、直播间链接或主播名直接连弹幕，
 * 不写进关注列表（不监听、不提醒），与 C# ConnectRoomDialog 语义一致。
 */
export function ConnectRoomWindow() {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestVersionRef = useRef(0);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const roomId = roomIdFromInput(input);
  const { candidates, clear, isSearching, search, searchError } =
    useStreamerSearch();

  function focusInput() {
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
  }

  async function hideWindow() {
    try {
      await invoke("hide_connect_room_window");
    } catch (hideError) {
      setError(String(hideError));
    }
  }

  async function connectRoom(requestedRoomId: string) {
    if (isConnecting) {
      return;
    }

    setIsConnecting(true);
    setError(null);
    try {
      await invoke("connect_bilibili_room", {
        requestedRoomId: Number(requestedRoomId),
      });
      await invoke("show_window", { label: "main" });
      await invoke("hide_connect_room_window");
    } catch (connectError) {
      setError(String(connectError));
    } finally {
      setIsConnecting(false);
    }
  }

  async function connect() {
    if (!roomId) {
      return;
    }
    await connectRoom(roomId);
  }

  /** 点了候选主播：把房间号填进去并直接连（和 C# 一样，用户意图已经很明确）。 */
  async function selectCandidate(candidate: StreamerCandidate) {
    if (!candidate.roomId || candidate.roomId <= 0) {
      setError(`${candidate.name} 还没有直播间，没法连弹幕。`);
      return;
    }
    const nextRoomId = String(candidate.roomId);
    setInput(nextRoomId);
    clear();
    await connectRoom(nextRoomId);
  }

  useEffect(() => {
    if (roomId || !input.trim()) {
      clear();
      return;
    }
    search(input);
  }, [clear, input, roomId, search]);

  useEffect(() => {
    const version = requestVersionRef.current + 1;
    requestVersionRef.current = version;

    if (!roomId) {
      setPreview("");
      return;
    }

    setPreview("正在查询房间状态…");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const status = await invoke<LiveRoomCheck>("live_check_room", {
            roomId,
          });
          if (version !== requestVersionRef.current) {
            return;
          }
          const liveText = status.isLive ? "直播中" : "未开播";
          const title = status.title.trim();
          setPreview(
            `房间 ${status.roomId} · ${liveText}${title ? ` · ${title}` : ""}`,
          );
        } catch {
          if (version !== requestVersionRef.current) {
            return;
          }
          // 查询失败不挡住连接：状态只是提示信息。
          setPreview(`房间 ${roomId}（状态查询失败，仍可尝试连接）`);
        }
      })();
    }, STATUS_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [roomId]);

  useEffect(() => {
    focusInput();

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        void hideWindow();
      }
    }

    const unlistenOpened = listen("connect-window-opened", () => {
      setInput("");
      setPreview("");
      setError(null);
      clear();
      focusInput();
    });

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      void unlistenOpened.then((unlisten) => unlisten());
    };
  }, [clear]);

  function hintText() {
    if (roomId) {
      return preview;
    }
    if (searchError) {
      return `搜索主播失败：${searchError}`;
    }
    if (isSearching) {
      return "正在搜索主播…";
    }
    if (candidates.length > 0) {
      return `搜到 ${candidates.length} 个主播，按回车选第一个`;
    }
    if (input.trim()) {
      return STREAMER_NOT_FOUND_HINT;
    }
    return "";
  }

  return (
    <main className="drift-theme-transition box-border flex h-screen w-screen flex-col gap-3 bg-[var(--drift-ui-surface)] p-4 text-[var(--drift-ui-ink)]">
      <div className="grid gap-1">
        <h1 className="text-sm font-semibold">连接直播间弹幕</h1>
        <p className="text-[11px] text-[var(--drift-ui-muted)]">
          输入房间号、直播间链接或主播名；连接后不会加入关注列表（不监听、不提醒）。
        </p>
      </div>

      <div className="relative grid gap-2">
        <Input
          aria-label="房间号、直播间链接或主播名"
          autoFocus
          id="connect-room-input"
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) {
              return;
            }
            event.preventDefault();
            if (!roomId && candidates.length > 0) {
              void selectCandidate(candidates[0]);
              return;
            }
            void connect();
          }}
          placeholder="房间号、直播间链接或主播名"
          ref={inputRef}
          value={input}
        />
        <StreamerCandidateList
          candidates={roomId ? [] : candidates}
          onSelect={(candidate) => void selectCandidate(candidate)}
        />
      </div>

      <p className="min-h-[16px] text-[11px] text-[var(--drift-ui-ink-soft)]">
        {hintText()}
      </p>

      {error ? (
        <StatusBanner description={error} title="连接失败" tone="danger" />
      ) : null}

      <div className="mt-auto flex justify-end gap-2">
        <Button onClick={() => void hideWindow()}>取消</Button>
        <Button
          disabled={!roomId || isConnecting}
          onClick={() => void connect()}
          variant="primary"
        >
          {isConnecting ? "连接中…" : "连接"}
        </Button>
      </div>
    </main>
  );
}
