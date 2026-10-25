import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HelpCircle } from "lucide-react";
import { useStreamerSearch } from "../../hooks/useStreamerSearch";
import { useVideoDanmaku } from "../../hooks/useVideoDanmaku";
import { STREAMER_NOT_FOUND_HINT, type StreamerCandidate } from "../../types/streamer";
import { type RoomSessionSnapshot } from "../../types/roomSession";
import { roomIdFromInput } from "../../utils/roomId";
import { Button, IconButton, Input, Tooltip, TooltipProvider } from "../ui";
import { StatusBanner } from "../control/settings-ui";
import { sessionStatusText } from "../control/RoomSessionList";
import { RoomAvatar } from "../control/SavedRoomList";
import { StreamerCandidateList } from "../StreamerCandidateList";
import { HomeVideoControl } from "./HomeVideoControl";

// 敲字后延迟这么久才查询房间状态，避免每敲一字打一次接口（对齐 C# 的 450ms 防抖）。
const STATUS_DEBOUNCE_MS = 450;

type LiveRoomCheck = {
  isLive: boolean;
  roomId: string;
  title: string;
};

type ConnectPanelProps = {
  commandErrors: Record<string, string>;
  onAddToSaved: (roomId: string) => void | Promise<void>;
  onDisconnectAll: () => void | Promise<void>;
  onDisconnectSession: (sessionId: string) => void | Promise<void>;
  temporarySessions: RoomSessionSnapshot[];
};

/**
 * 主界面顶部的「临时连接」区块（对齐 Drift 的连接框，并把 C# 老版的
 * 「房间号 / 直播间链接 / 主播名」三种输入合到一起）：
 * 连上的房间不写进关注列表，只临时收弹幕；想留下点「加入关注」。
 */
export function ConnectPanel({
  commandErrors,
  onAddToSaved,
  onDisconnectAll,
  onDisconnectSession,
  temporarySessions,
}: ConnectPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef(0);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [videoInput, setVideoInput] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isOpeningVideo, setIsOpeningVideo] = useState(false);
  // 主界面也要显示视频进度：连上以后这一块才出现，断开就消失。
  const {
    close: closeVideoDanmaku,
    control: controlVideoDanmaku,
    progress: videoProgress,
    snapshot: videoSnapshot,
  } = useVideoDanmaku(true);
  const roomId = roomIdFromInput(input);
  const { candidates, clear, isSearching, search, searchError } =
    useStreamerSearch();

  const activeCount = temporarySessions.filter(
    (session) => session.status === "connected" || session.status === "connecting",
  ).length;

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
      // 弹幕层默认隐藏，连上以后才出现（对齐 C# 老版）。
      await invoke("show_window", { label: "main" });
      setInput("");
      setPreview("");
      clear();
    } catch (connectError) {
      setError(String(connectError));
    } finally {
      setIsConnecting(false);
    }
  }

  /**
   * 打开 B 站点播视频的弹幕：入口和临时连接一样，只是不收直播间弹幕，
   * 而是按视频时间轴把弹幕放出来（弹幕层底部会出现进度条）。
   */
  async function openVideoDanmaku() {
    const value = videoInput.trim();
    if (!value || isOpeningVideo) {
      return;
    }
    setIsOpeningVideo(true);
    setVideoError(null);
    try {
      await invoke("open_video_danmaku", { input: value });
      // 弹幕层平时隐藏，和临时连接一样打开后才出现。
      await invoke("show_window", { label: "main" });
      setVideoInput("");
    } catch (openError) {
      setVideoError(String(openError));
    } finally {
      setIsOpeningVideo(false);
    }
  }

  /** 点了候选主播：把房间号填进去并直接连（和 C# 一样，用户意图已经很明确）。 */
  async function selectCandidate(candidate: StreamerCandidate) {
    if (!candidate.roomId || candidate.roomId <= 0) {
      setError(`${candidate.name} 还没有直播间，没法连弹幕。`);
      return;
    }
    clear();
    await connectRoom(String(candidate.roomId));
  }

  // 输入不是房间号时才当主播名去搜。
  useEffect(() => {
    if (roomId || !input.trim()) {
      clear();
      return;
    }
    search(input);
  }, [clear, input, roomId, search]);

  // 房间号确定后防抖查一次状态，只是提示信息，失败不挡住连接。
  useEffect(() => {
    const version = versionRef.current + 1;
    versionRef.current = version;

    if (!roomId) {
      setPreview("");
      return;
    }

    setPreview("正在查询房间状态…");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const status = await invoke<LiveRoomCheck>("live_check_room", { roomId });
          if (version !== versionRef.current) {
            return;
          }
          const liveText = status.isLive ? "直播中" : "未开播";
          const title = status.title.trim();
          setPreview(
            `房间 ${status.roomId} · ${liveText}${title ? ` · ${title}` : ""}`,
          );
        } catch {
          if (version !== versionRef.current) {
            return;
          }
          setPreview(`房间 ${roomId}（状态查询失败，仍可尝试连接）`);
        }
      })();
    }, STATUS_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [roomId]);

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
    return "输入房间号、直播间链接或主播名；临时连接不会加入关注列表。";
  }

  return (
    <TooltipProvider delayDuration={300}>
      <section className="drift-theme-transition min-w-0 rounded-[14px] border border-[var(--drift-ui-line)] bg-[var(--drift-ui-raised)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--drift-ui-ink)]">
            <span className="size-1.5 rounded-full bg-[#fb7299]" />
            临时连接
            {temporarySessions.length > 0
              ? ` · ${temporarySessions.length}`
              : ""}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {activeCount > 0 ? (
              <Button
                onClick={() => void onDisconnectAll()}
                size="sm"
                variant="danger"
              >
                全部断开
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[44px_minmax(0,1fr)_28px_88px] items-center gap-2">
          <span className="text-[11px] text-[var(--drift-ui-ink-soft)]">
            房间号
          </span>
          <Input
            aria-label="房间号、直播间链接或主播名"
            id="home-connect-input"
            inputSize="sm"
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
              if (roomId) {
                void connectRoom(roomId);
              }
            }}
            placeholder="房间号、直播间链接或主播名"
            ref={inputRef}
            value={input}
          />
          <Tooltip content="在 B 站直播间地址里，live.bilibili.com/ 后面那串数字就是房间号；也可以直接粘贴链接或打主播名。">
            <IconButton aria-label="房间号怎么填" size="sm" type="button">
              <HelpCircle aria-hidden="true" size={13} />
            </IconButton>
          </Tooltip>
          <Button
            disabled={!roomId || isConnecting}
            onClick={() => roomId && void connectRoom(roomId)}
            size="sm"
            variant="primary"
          >
            {isConnecting ? "连接中…" : "连接"}
          </Button>
        </div>

        <StreamerCandidateList
          candidates={roomId ? [] : candidates}
          onSelect={(candidate) => void selectCandidate(candidate)}
        />

        <p className="mt-2 min-h-[16px] text-[11px] text-[var(--drift-ui-ink-soft)]">
          {hintText()}
        </p>

        {error ? (
          <StatusBanner description={error} title="连接失败" tone="danger" />
        ) : null}

        <div className="mt-3 border-t border-[var(--drift-ui-line)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-[12px] font-semibold text-[var(--drift-ui-ink)]">
              <span className="size-1.5 rounded-full bg-[#00aeec]" />
              视频弹幕
            </h3>
            <span className="text-[10px] text-[var(--drift-ui-muted)]">
              BV 号 / 视频链接，可带 ?p= 选分P
            </span>
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_88px] items-center gap-2">
            <Input
              aria-label="BV 号或视频链接"
              id="home-video-input"
              inputSize="sm"
              onChange={(event) => setVideoInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) {
                  return;
                }
                event.preventDefault();
                void openVideoDanmaku();
              }}
              placeholder="例如 BV1Js411o76u 或视频页链接"
              value={videoInput}
            />
            <Button
              disabled={!videoInput.trim() || isOpeningVideo}
              onClick={() => void openVideoDanmaku()}
              size="sm"
              variant="primary"
            >
              {isOpeningVideo ? "打开中…" : "打开"}
            </Button>
          </div>
          {videoError ? (
            <StatusBanner
              description={videoError}
              title="打开视频弹幕失败"
              tone="danger"
            />
          ) : null}
          {videoSnapshot ? (
            <HomeVideoControl
              onClose={closeVideoDanmaku}
              onControl={controlVideoDanmaku}
              progress={videoProgress}
              snapshot={videoSnapshot}
            />
          ) : null}
        </div>

        {temporarySessions.length > 0 ? (
          <div className="mt-2 grid gap-1.5">
            {temporarySessions.map((session) => {
              const error_text = commandErrors[session.sessionId];
              return (
                <div
                  className="drift-theme-transition grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[var(--drift-ui-line)] bg-[var(--drift-ui-surface)] px-3 py-2"
                  key={session.sessionId}
                >
                  {/* 临时连接也显示主播头像；后端还没取到图（或加载失败）时退回名字首字、无名则退回「临」。 */}
                  <RoomAvatar
                    name={session.anchorName || "临"}
                    path={session.anchorAvatar}
                  />
                  <div className="grid min-w-0 gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <strong className="truncate text-[11px] text-drift-ink">
                        {session.anchorName || `房间 ${session.requestedRoomId}`}
                      </strong>
                      <span className="shrink-0 rounded-full bg-[var(--drift-ui-hover)] px-2 py-0.5 text-[10px] font-semibold text-[var(--drift-ui-muted)]">
                        未加入关注
                      </span>
                      <span className="drift-data-text shrink-0 text-[10px] text-[var(--drift-ui-muted)]">
                        {session.requestedRoomId}
                      </span>
                    </div>
                    <span className="drift-theme-transition truncate text-[9px] text-[var(--drift-ui-muted)]">
                      {sessionStatusText(session)}
                      {session.message ? ` · ${session.message}` : ""}
                    </span>
                    {error_text ? (
                      <span
                        className="text-[9px] text-[var(--drift-ui-danger)]"
                        role="alert"
                      >
                        {error_text}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      aria-label={`加入关注 ${session.requestedRoomId}`}
                      onClick={() => void onAddToSaved(String(session.requestedRoomId))}
                      size="sm"
                    >
                      加入关注
                    </Button>
                    <Button
                      aria-label={`断开 ${session.requestedRoomId}`}
                      onClick={() => void onDisconnectSession(session.sessionId)}
                      size="sm"
                      variant="danger"
                    >
                      断开
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </TooltipProvider>
  );
}
