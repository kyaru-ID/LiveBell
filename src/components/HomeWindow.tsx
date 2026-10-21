import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Bell, Plus, Settings, Unplug } from "lucide-react";
import { useControlConfig } from "../hooks/control/useControlConfig";
import { useRoomConnections } from "../hooks/control/useRoomConnections";
import { useRoomSessions } from "../hooks/useRoomSessions";
import { useSavedRooms } from "../hooks/control/useSavedRooms";
import {
  UNGROUPED_SAVED_ROOM_GROUP_ID,
  type AppConfig,
  type SavedRoom,
} from "../types/config";
import { isNetworkSessionActive } from "../types/roomSession";
import { Button, Tooltip } from "./ui";
import { AppLogo } from "./ui/AppLogo";
import { SavedRoomGroupControls } from "./control/SavedRoomGroupControls";
import { SavedRoomList } from "./control/SavedRoomList";
import { ConnectPanel } from "./home/ConnectPanel";

const NOTIFICATIONS_TAB = "notifications";
const ERROR_MUTED = "text-[var(--drift-ui-danger)]";
const MUTED = "text-[var(--drift-ui-muted)]";

type HomeWindowProps = {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
};

/**
 * 主界面（label=home）。布局是 Drift 那套卡片列表，外加一个常驻的「临时连接」区块：
 * 连接入口放在区块里（用户要求从顶栏下放），关注列表只做管理不做过滤。
 * 配色走设置界面同一套 --drift-ui-* 令牌，所以根元素要挂 drift-control-shell。
 */
export function HomeWindow({ config, onConfigChange }: HomeWindowProps) {
  const { saveConfig } = useControlConfig({ config, onConfigChange });
  const { sessions, snapshotError } = useRoomSessions({ enabled: true });
  const rooms = useSavedRooms({ config, saveConfig });
  const connections = useRoomConnections({ config, saveConfig, sessions });
  const [draggedRoomId, setDraggedRoomId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [windowError, setWindowError] = useState("");

  // 后端把头像下载缓存到 Data/Avatars 后写回配置，前端只负责显示本地文件。
  // 依赖关注列表：新增/编辑主播后要立刻补头像，不能只在窗口挂载时同步一次。
  const roomIdsKey = config.savedRooms.map((room) => room.id).join(",");
  useEffect(() => {
    void invoke("sync_room_avatars").catch(() => undefined);
  }, [roomIdsKey]);

  useEffect(() => {
    let disposed = false;
    async function refreshUnreadCount() {
      try {
        const count = await invoke<number>("notifications_unread_count");
        if (!disposed) {
          setUnreadCount(typeof count === "number" ? count : 0);
        }
      } catch {
        if (!disposed) {
          setUnreadCount(0);
        }
      }
    }

    void refreshUnreadCount();
    const unlisten = listen("notifications-changed", () => {
      void refreshUnreadCount();
    });
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  /** control 窗口是启动时就建好的常驻窗口，事件不会丢。 */
  async function openControlWindow(tab?: string) {
    setWindowError("");
    try {
      await invoke("show_window", { label: "control" });
      if (tab) {
        await emitTo("control", "navigate-settings", { tab });
      }
    } catch (error) {
      setWindowError(errorMessage(error));
    }
  }

  /** 新建（room 为空）或编辑（带 id）都走同一个「主播信息」窗口。 */
  async function openStreamerWindow(room?: SavedRoom) {
    setWindowError("");
    try {
      await invoke("open_streamer_dialog_window", {
        savedRoomId: room?.id ?? null,
      });
    } catch (error) {
      setWindowError(errorMessage(error));
    }
  }

  const enabledCount = config.savedRooms.filter((room) => room.isEnabled).length;
  const connectedCount = sessions.filter((session) =>
    isNetworkSessionActive(session.status),
  ).length;
  const errorText =
    windowError ||
    rooms.savedRoomError ||
    connections.selectionError ||
    snapshotError;

  return (
    <div className="drift-control-shell drift-theme-transition flex h-screen w-screen flex-col bg-[var(--drift-ui-workspace)] text-[var(--drift-ui-ink)]">
      <header className="flex items-center gap-3 border-b border-[var(--drift-ui-line)] bg-[var(--drift-ui-raised)] px-6 py-[11px] shadow-[0_1px_0_var(--drift-ui-line)]">
        <AppLogo size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-bold leading-tight">LiveBell</div>
          <div className="text-[11px] text-[var(--drift-ui-muted)]">
            主播开播提醒与弹幕悬浮窗
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void openControlWindow(NOTIFICATIONS_TAB)}
            size="sm"
          >
            <Bell className="mr-1 h-4 w-4" />
            通知
            {unreadCount > 0 ? (
              <span className="ml-1 rounded-full bg-[#fb7299] px-1.5 text-[11px] leading-4 text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Button>
          <Button onClick={() => void openControlWindow()} size="sm">
            <Settings className="mr-1 h-4 w-4" />
            设置
          </Button>
          <Button
            onClick={() => void openStreamerWindow()}
            size="sm"
            variant="primary"
          >
            <Plus className="mr-1 h-4 w-4" />
            添加主播
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 min-w-0 flex-1 content-start gap-3 overflow-y-auto overflow-x-hidden px-6 py-4">
        <ConnectPanel
          commandErrors={connections.commandErrors}
          onAddToSaved={(roomId) => rooms.saveRoom(roomId)}
          onDisconnectAll={connections.disconnectAllRooms}
          onDisconnectSession={connections.disconnectSession}
          temporarySessions={connections.temporarySessions}
        />

        {/*
        「全部断开」作为 trailingActions 挂进分组条那一行的右端：
        这样分组条的输入面板能横跨整行宽度，和下面卡片、这个按钮左右对齐。
        */}
        <SavedRoomGroupControls
          createActionPosition="tabs-end"
          draggedRoomId={draggedRoomId}
          groups={config.savedRoomGroups}
          onCreateGroup={rooms.createSavedRoomGroup}
          onDeleteGroup={rooms.deleteSavedRoomGroup}
          onDropRoomToGroup={(savedRoomId, groupId) => {
            const room = config.savedRooms.find(
              (item) => item.id === savedRoomId,
            );
            if (!room) {
              return;
            }
            const groupIds =
              groupId === UNGROUPED_SAVED_ROOM_GROUP_ID
                ? []
                : room.groupIds.includes(groupId)
                  ? room.groupIds
                  : [...room.groupIds, groupId];
            return rooms.setSavedRoomGroupIds(savedRoomId, groupIds);
          }}
          onRenameGroup={rooms.renameSavedRoomGroup}
          onSearchQueryChange={() => undefined}
          onSelectedGroupChange={rooms.setSelectedSavedRoomGroupId}
          searchQuery=""
          selectedGroupId={rooms.selectedSavedRoomGroupId}
          showSearch={false}
          trailingActions={
            <Tooltip content="断开当前所有正在连接的直播间">
              <Button
                disabled={sessions.length === 0}
                onClick={() => void connections.disconnectAllRooms()}
                size="sm"
                variant="danger"
              >
                <Unplug className="h-4 w-4" />
                全部断开
              </Button>
            </Tooltip>
          }
        />
        {connections.commandErrors.all ? (
          <div className={"text-xs " + MUTED}>
            {connections.commandErrors.all}
          </div>
        ) : null}

        {errorText ? (
          <div className={"text-xs " + ERROR_MUTED}>{errorText}</div>
        ) : null}

        {rooms.filteredSavedRooms.length === 0 ? (
          <div className="grid place-items-center gap-3 rounded-[14px] border border-[var(--drift-ui-line)] bg-[var(--drift-ui-raised)] py-14 text-center">
            <AppLogo decorative size={64} />
            <div className="grid gap-1">
              <strong className="text-[18px] font-semibold">
                还没有关注的主播
              </strong>
              <span className="text-[12px] text-[var(--drift-ui-muted)]">
                点右上角「＋ 添加主播」搜索并关注，LiveBell 会在后台持续监听
              </span>
            </div>
          </div>
        ) : (
          <SavedRoomList
            commandErrors={connections.commandErrors}
            editingSavedRoom={rooms.editingSavedRoom}
            groups={config.savedRoomGroups}
            onConnectRoom={connections.connectSavedRoom}
            onDeleteRoom={rooms.deleteSavedRoom}
            onDisconnectSession={connections.disconnectSession}
            onDragRoomEnd={() => setDraggedRoomId(null)}
            onDragRoomStart={setDraggedRoomId}
            onEditRoomChange={rooms.setEditingSavedRoom}
            onMoveRoom={rooms.moveSavedRoom}
            onRetrySession={connections.retrySession}
            onSaveEditedRoom={rooms.saveEditedRoom}
            onStartEditRoom={rooms.startEditSavedRoom}
            onStopEditRoom={() => rooms.setEditingSavedRoom(null)}
            onToggleRoomEnabled={(room, enabled) =>
              rooms.setSavedRoomEnabled(room.id, enabled)
            }
            rooms={rooms.filteredSavedRooms}
            sessions={sessions}
            showLiveDuration={config.notification.showLiveDuration}
          />
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-[var(--drift-ui-line)] bg-[var(--drift-ui-surface)] px-6 py-2 text-[12px] text-[var(--drift-ui-muted)]">
        <span className="h-[7px] w-[7px] rounded-full bg-[var(--drift-ui-success)]" />
        <span>
          共 {config.savedRooms.length} 个关注 · 开提醒 {enabledCount} 个 · 已连接{" "}
          {connectedCount} 个
        </span>
        <span className="ml-auto text-[11px] text-[var(--drift-ui-subtle)]">
          关闭窗口后仍会在托盘运行
        </span>
      </footer>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
