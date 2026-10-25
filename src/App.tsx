import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ConnectRoomWindow } from "./components/ConnectRoomWindow";
import { StreamerDialogWindow } from "./components/StreamerDialogWindow";
import { HomeWindow } from "./components/HomeWindow";
import { ControlPanel } from "./components/control/ControlPanel";
import { DanmakuOverlay } from "./components/DanmakuOverlay";
import {
  OnlineCountBadges,
  buildOnlineBadges,
  type OnlineCountEntry,
} from "./components/OnlineCountBadges";
import { VideoProgressBar } from "./components/VideoProgressBar";
import { VerticalChatOverlay } from "./components/VerticalChatOverlay";
import {
  OverlayEditWorkspace,
  type OverlayResizeDirection,
} from "./components/OverlayEditWorkspace";
import { NotificationWindow } from "./components/NotificationWindow";
import { SendDanmakuWindow } from "./components/SendDanmakuWindow";
import { TooltipProvider } from "./components/ui";
import { useDanmakuRuntime } from "./hooks/useDanmakuRuntime";
import { useRoomSessions } from "./hooks/useRoomSessions";
import { useVideoDanmaku } from "./hooks/useVideoDanmaku";
import {
  DEFAULT_APP_CONFIG,
  defaultShortcutLabel,
  mergeAppConfig,
  type AppConfig,
} from "./types/config";
import { isNetworkSessionActive } from "./types/roomSession";
import type { DanmakuRoomBatch } from "./types/roomSession";
import type { VerticalFlowStatus } from "./types/verticalFlow";
import {
  MIN_TRACK_COUNT,
  TRACK_HEIGHT,
} from "./utils/danmakuRuntime";
import { classNames } from "./utils/classNames";
import {
  applyDocumentUiTheme,
  applyNativeAppTheme,
  readBootstrapUiTheme,
} from "./utils/uiTheme";
import "./styles/tailwind.css";
import "./App.css";

const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 160;
const DEFAULT_SHORTCUT = defaultShortcutLabel();
function selectSafeVerticalFlowStatus(
  status: VerticalFlowStatus,
): VerticalFlowStatus {
  return {
    active: status.active,
    policy: status.policy,
    backlog: status.backlog,
    speedMultiplier: status.speedMultiplier,
    droppedTotal: status.droppedTotal,
  };
}

function sameVerticalFlowStatus(
  previous: VerticalFlowStatus | null,
  next: VerticalFlowStatus,
) {
  return (
    previous !== null &&
    previous.active === next.active &&
    previous.policy === next.policy &&
    previous.backlog === next.backlog &&
    previous.speedMultiplier === next.speedMultiplier &&
    previous.droppedTotal === next.droppedTotal
  );
}

type OnlineCountChanged = {
  sessionId: string;
  roomId: number;
  // null 表示清空徽章（会话断开 / 还没取到数字）。
  online: number | null;
};

type EditModeChanged = {
  is_edit_mode: boolean;
  is_click_through: boolean;
  shortcut: string;
};

function createInitialConfig(): AppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    appearance: {
      ...DEFAULT_APP_CONFIG.appearance,
      theme: readBootstrapUiTheme(),
    },
  };
}

function App() {
  const windowLabel = getCurrentWindow().label;
  const [isClickThrough, setIsClickThrough] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [trackCount, setTrackCount] = useState(MIN_TRACK_COUNT);
  // 多房间并行连接：同接数按会话分开存（只留一个值的话，几个房间会互相覆盖）。
  const [onlineBySession, setOnlineBySession] = useState<
    Map<string, OnlineCountEntry>
  >(() => new Map());
  const [config, setConfig] = useState<AppConfig>(createInitialConfig);
  const { isInitialReady: roomSessionsReady, sessions: roomSessions } = useRoomSessions({
    enabled: windowLabel === "main",
  });
  const {
    close: closeVideoDanmaku,
    control: controlVideoDanmaku,
    progress: videoProgress,
    seekToken: videoSeekToken,
    snapshot: videoSnapshot,
  } = useVideoDanmaku(windowLabel === "main");
  // 视频暂停时冻结屏幕上的弹幕；直播没有暂停概念，这里只对视频会话生效。
  const videoPaused =
    videoSnapshot !== null &&
    !(videoProgress?.playing ?? videoSnapshot.playing);
  const {
    enqueueLiveBatch,
    handleMockRateChange,
    historySnapshot,
    items,
    messageFlow,
    mock,
    pruneVerticalItems,
    removeDanmakuItem,
    roomSources,
    setShowStats,
    setShowHistory,
    showHistory,
    showStats,
    sourceColorBySession,
    startMockDanmaku,
    statsSnapshots,
    stopMockDanmaku,
    triggerMockBurst,
    verticalFlowStatus,
    verticalItems,
  } = useDanmakuRuntime({
    config,
    roomSessions,
    roomSessionsReady,
    // 纯视频弹幕没有直播间会话；不告诉运行时会因为没有“直播源”而整条渲染循环不启动。
    videoActive: videoSnapshot !== null,
    videoPaused,
    videoPositionMs: videoProgress?.positionMs ?? videoSnapshot?.positionMs ?? 0,
    videoSeekToken,
    trackCount,
    windowLabel,
  });
  const verticalFlowStatusRef = useRef(
    selectSafeVerticalFlowStatus(verticalFlowStatus),
  );
  const verticalFlowListenerReadyRef = useRef(false);
  const lastScheduledVerticalFlowStatusRef =
    useRef<VerticalFlowStatus | null>(null);
  const verticalFlowEmitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const verticalFlowWarningLatchedRef = useRef(false);

  const publishVerticalFlowStatus = useCallback((force = false) => {
    const snapshot = selectSafeVerticalFlowStatus(
      verticalFlowStatusRef.current,
    );
    if (
      !force &&
      sameVerticalFlowStatus(
        lastScheduledVerticalFlowStatusRef.current,
        snapshot,
      )
    ) {
      return;
    }
    lastScheduledVerticalFlowStatusRef.current = snapshot;

    verticalFlowEmitQueueRef.current = verticalFlowEmitQueueRef.current.then(
      async () => {
        try {
          await emit("vertical-flow-status", snapshot);
          verticalFlowWarningLatchedRef.current = false;
        } catch {
          if (!verticalFlowWarningLatchedRef.current) {
            verticalFlowWarningLatchedRef.current = true;
            console.warn("Failed to publish vertical flow status.");
          }
        }
      },
    );
  }, []);

  async function setEditMode(enabled: boolean) {
    const result = await invoke<EditModeChanged>("set_edit_mode", { enabled });
    setIsEditMode(result.is_edit_mode);
    setIsClickThrough(result.is_click_through);
    setShortcut(result.shortcut);
  }

  async function exitEditMode() {
    await setEditMode(false);
  }

  async function startDragging(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || !isEditMode) {
      return;
    }

    event.preventDefault();
    await getCurrentWindow().startDragging();
  }

  async function startResizeDragging(
    direction: OverlayResizeDirection,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0 || !isEditMode) {
      return;
    }

    event.preventDefault();
    await getCurrentWindow().startResizeDragging(direction);
  }

  useLayoutEffect(() => {
    if (windowLabel !== "main") {
      return;
    }

    const safeStatus = selectSafeVerticalFlowStatus(verticalFlowStatus);
    verticalFlowStatusRef.current = safeStatus;
    if (verticalFlowListenerReadyRef.current) {
      publishVerticalFlowStatus();
    }
  }, [publishVerticalFlowStatus, verticalFlowStatus, windowLabel]);

  useEffect(() => {
    if (windowLabel !== "main") {
      return;
    }

    let disposed = false;
    let disposeListener: (() => void) | undefined;
    const listener = listen("vertical-flow-status-request", () => {
      publishVerticalFlowStatus(true);
    });
    void listener
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          disposeListener = dispose;
          verticalFlowListenerReadyRef.current = true;
          publishVerticalFlowStatus();
        }
      })
      .catch(() => {
        console.warn("Failed to listen for vertical flow status requests.");
      });

    return () => {
      disposed = true;
      verticalFlowListenerReadyRef.current = false;
      disposeListener?.();
    };
  }, [publishVerticalFlowStatus, windowLabel]);

  useEffect(() => {
    if (windowLabel === "send") {
      return;
    }

    let disposed = false;
    let receivedConfigEvent = false;
    const unlistenConfig = listen<AppConfig>("app-config-changed", (event) => {
      receivedConfigEvent = true;
      if (!disposed) {
        setConfig(mergeAppConfig(event.payload));
      }
    });

    void (async () => {
      await unlistenConfig;
      if (disposed) {
        return;
      }

      const loadedConfig = await invoke<AppConfig>("load_app_config");
      if (!disposed && !receivedConfigEvent) {
        setConfig(mergeAppConfig(loadedConfig));
      }
    })();

    const unlistenMessage =
      windowLabel === "main"
        ? listen<DanmakuRoomBatch>("danmaku-messages", (event) => {
            enqueueLiveBatch(event.payload);
          })
        : Promise.resolve(() => undefined);
    // 同接数：与弹幕消息并列的另一条通道（对齐 C# 老版 DanmakuClient.OnlineCountChanged）。
    const unlistenOnlineCount =
      windowLabel === "main"
        ? listen<OnlineCountChanged>("online-count-changed", (event) => {
            const { sessionId, roomId, online } = event.payload;
            setOnlineBySession((previous) => {
              const next = new Map(previous);
              if (online === null) {
                next.delete(sessionId);
              } else {
                next.set(sessionId, { roomId, online });
              }
              return next;
            });
          })
        : Promise.resolve(() => undefined);
    const unlistenEditMode = listen<EditModeChanged>(
      "edit-mode-changed",
      (event) => {
        setIsEditMode(event.payload.is_edit_mode);
        setIsClickThrough(event.payload.is_click_through);
        setShortcut(event.payload.shortcut);
      },
    );
    return () => {
      disposed = true;
      void unlistenMessage.then((unlisten) => unlisten());
      void unlistenOnlineCount.then((unlisten) => unlisten());
      void unlistenEditMode.then((unlisten) => unlisten());
      void unlistenConfig.then((unlisten) => unlisten());
    };
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel === "send") {
      return;
    }

    const theme = config.appearance.theme;
    applyDocumentUiTheme(theme);
    void applyNativeAppTheme(theme);
  }, [config.appearance.theme, windowLabel]);

  // 会话消失后丢掉它的同接数，免得徽章留着已经断开那间的数字
  //（对齐 C# 老版断开弹幕时 SetOnlineCount(null) 的做法，只是改成按会话清理）。
  useEffect(() => {
    if (windowLabel !== "main") {
      return;
    }

    const activeSessionIds = new Set(
      roomSessions
        .filter((session) => isNetworkSessionActive(session.status))
        .map((session) => session.sessionId),
    );
    setOnlineBySession((previous) => {
      let removed = false;
      const next = new Map(previous);
      for (const sessionId of previous.keys()) {
        if (!activeSessionIds.has(sessionId)) {
          next.delete(sessionId);
          removed = true;
        }
      }
      return removed ? next : previous;
    });
  }, [roomSessions, windowLabel]);

  useEffect(() => {
    if (windowLabel !== "main") {
      return;
    }

    // 弹幕层默认不显示（tauri.conf.json 里 main 窗口 visible=false），连接房间后才出现；
    // 这里也不再自动进入编辑模式——对齐 C# 老版「启动只显示主界面」。需要调位置时用托盘
    // 「切换模式」或快捷键（默认 Control+Alt+K）。
    void getCurrentWindow().setSizeConstraints({
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
    });
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel !== "main") {
      return;
    }

    function updateTrackCount() {
      setTrackCount(
        Math.max(MIN_TRACK_COUNT, Math.floor(window.innerHeight / TRACK_HEIGHT)),
      );
    }

    updateTrackCount();
    window.addEventListener("resize", updateTrackCount);
    return () => window.removeEventListener("resize", updateTrackCount);
  }, [windowLabel]);

  useEffect(() => {
    if (!isEditMode) {
      setShowHistory(false);
      setShowStats(false);
    }
  }, [isEditMode, setShowHistory, setShowStats]);

  function toggleHistoryDrawer() {
    setShowHistory((prev) => {
      const next = !prev;
      if (next) {
        setShowStats(false);
      }
      return next;
    });
  }

  function toggleStatsDrawer() {
    setShowStats((prev) => {
      const next = !prev;
      if (next) {
        setShowHistory(false);
      }
      return next;
    });
  }

  function showMockWorkspace() {
    setShowHistory(false);
    setShowStats(false);
  }

  if (windowLabel === "control") {
    return (
      <ControlPanel
        config={config}
        onConfigChange={(nextConfig) => setConfig(mergeAppConfig(nextConfig))}
      />
    );
  }

  if (windowLabel === "home") {
    // 主界面的悬停提示统一走这里提供的 provider（分组、全部断开等都要用）。
    return (
      <TooltipProvider delayDuration={300}>
        <HomeWindow
          config={config}
          onConfigChange={(nextConfig) => setConfig(mergeAppConfig(nextConfig))}
        />
      </TooltipProvider>
    );
  }

  if (windowLabel === "send") {
    return <SendDanmakuWindow />;
  }

  if (windowLabel === "connect") {
    return <ConnectRoomWindow />;
  }

  if (windowLabel === "streamer") {
    return <StreamerDialogWindow />;
  }

  if (windowLabel === "notification") {
    return <NotificationWindow />;
  }

  const onlineBadges = buildOnlineBadges(
    roomSessions,
    onlineBySession,
    sourceColorBySession,
  );

  return (
    <main
      className={classNames(
        "relative h-screen w-screen min-w-0 overflow-hidden",
        isClickThrough && "is-click-through",
        isEditMode
          ? "is-edit-mode bg-[var(--drift-ui-edit-backdrop)] [outline:1px_dashed_var(--drift-ui-edit-outline)]"
          : "is-display-mode bg-transparent outline-0",
      )}
      style={
        {
          "--danmaku-font-size": `${config.appearance.fontSize}px`,
          "--danmaku-opacity": config.appearance.opacity,
          // 表情大小：只缩放弹幕里的表情图片（对齐 C# 老版「表情大小」滑块 50–200%）。
          "--danmaku-emote-scale": String(config.appearance.emoteScale ?? 1),
        } as CSSProperties
      }
    >
      {config.messageDisplay.showOnlineCount ? (
        <OnlineCountBadges badges={onlineBadges} />
      ) : null}
      {messageFlow === "vertical" ? (
        <VerticalChatOverlay
          items={verticalItems}
          onItemsPruned={pruneVerticalItems}
          showEmotes={config.messageDisplay.showEmotes}
        />
      ) : (
        <DanmakuOverlay
          items={items}
          onItemDone={removeDanmakuItem}
          paused={videoPaused}
          showEmotes={config.messageDisplay.showEmotes}
          showUsername={config.appearance.showUsername}
          trackCount={trackCount}
        />
      )}
      {videoSnapshot && isEditMode ? (
        <VideoProgressBar
          onClose={() => void closeVideoDanmaku()}
          onControl={controlVideoDanmaku}
          progress={videoProgress}
          snapshot={videoSnapshot}
        />
      ) : null}
      {isEditMode ? (
        <OverlayEditWorkspace
          historyMessages={historySnapshot}
          mock={
            config.mockPanelEnabled
              ? {
                  active: mock.active,
                  onBurst: triggerMockBurst,
                  onRateChange: handleMockRateChange,
                  onStart: startMockDanmaku,
                  onStop: stopMockDanmaku,
                  rate: mock.rate,
                  totalGenerated: mock.totalGenerated,
                }
              : null
          }
          onDragStart={startDragging}
          onExit={() => void exitEditMode()}
          onResizeStart={(direction, event) =>
            void startResizeDragging(direction, event)
          }
          onShowMock={showMockWorkspace}
          onToggleHistory={toggleHistoryDrawer}
          onToggleStats={toggleStatsDrawer}
          raiseMock={videoSnapshot !== null}
          roomSources={roomSources}
          shortcut={shortcut}
          showHistory={showHistory}
          showStats={showStats}
          statsSnapshots={statsSnapshots}
        />
      ) : null}
    </main>
  );
}

export default App;
