import { useEffect, useState } from "react";
import { avatarSrc } from "../../utils/avatar";
import { openExternalUrl } from "../../utils/openExternal";
import { Check, ExternalLink, Pencil, Trash2, X } from "lucide-react";
import {
  type LiveState,
  type SavedRoom,
  type SavedRoomGroup,
} from "../../types/config";
import {
  isNetworkSessionActive,
  type RoomSessionSnapshot,
} from "../../types/roomSession";
import { findRoomSession } from "../../hooks/control/useRoomConnections";
import { formatLiveDuration } from "../../utils/liveDuration";
import { bilibiliRoomUrl } from "../../utils/roomId";
import {
  Button,
  IconButton,
  Input,
  Toggle,
  Tooltip,
  TooltipProvider,
} from "../ui";
import { EmptyState } from "./settings-ui";
import { sessionStatusText } from "./RoomSessionList";

export type EditingSavedRoom = {
  displayName: string;
  groupIds: string[];
  id: string;
  roomId: string;
};

type SavedRoomListProps = {
  commandErrors: Record<string, string>;
  editingSavedRoom: EditingSavedRoom | null;
  groups: SavedRoomGroup[];
  onConnectRoom: (room: SavedRoom) => void | Promise<void>;
  onDeleteRoom: (roomId: string) => void;
  onDisconnectSession: (sessionId: string) => void | Promise<void>;
  onDragRoomEnd: () => void;
  onDragRoomStart: (savedRoomId: string) => void;
  onEditRoomChange: (room: EditingSavedRoom) => void;
  onMoveRoom: (
    sourceSavedRoomId: string,
    targetSavedRoomId: string,
  ) => void | Promise<void>;
  onRetrySession: (session: RoomSessionSnapshot) => void | Promise<void>;
  onSaveEditedRoom: () => void;
  onStartEditRoom: (room: SavedRoom) => void;
  onStopEditRoom: () => void;
  onToggleRoomEnabled: (
    room: SavedRoom,
    enabled: boolean,
  ) => void | Promise<void>;
  rooms: SavedRoom[];
  sessions: RoomSessionSnapshot[];
  /** 是否在直播中的卡片上显示「已开播多久」，来自通知设置里的开关。 */
  showLiveDuration?: boolean;
};

export function SavedRoomList({
  commandErrors,
  editingSavedRoom,
  groups,
  onConnectRoom,
  onDeleteRoom,
  onDisconnectSession,
  onDragRoomEnd,
  onDragRoomStart,
  onEditRoomChange,
  onMoveRoom,
  onRetrySession,
  onSaveEditedRoom,
  onStartEditRoom,
  onStopEditRoom,
  onToggleRoomEnabled,
  rooms,
  sessions,
  showLiveDuration = true,
}: SavedRoomListProps) {
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  // 已开播时长每分钟重算一次：不重渲染的话数字会一直停在打开列表那一刻。
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (rooms.length === 0) {
    return (
      <EmptyState
        description="输入房间号后保存到这里。"
        title="暂无常用直播间"
      />
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="settings-scroll-list grid min-h-0 content-start gap-1.5 pr-1">
        {rooms.map((room) => {
          const isEditing = editingSavedRoom?.id === room.id;
          const session = findRoomSession(room, sessions);
          const active = session && isNetworkSessionActive(session.status);
          const commandError =
            commandErrors[room.id] ||
            (session ? commandErrors[session.sessionId] : "");
          const isDragSource = dragSourceId === room.id;
          // 开播状态检查是后台内部细节，没有结果时不留字样（用户要求去掉「等待检查」「检查失败」）
          const liveText = liveStateText(room.liveState);
          const liveDuration =
            showLiveDuration && room.liveState === "live"
              ? formatLiveDuration(room.liveStartedAt, nowMs)
              : null;

          return (
            <div
              className={
                isEditing
                  ? "drift-theme-transition grid min-w-0 grid-cols-[minmax(0,1fr)_88px_96px_auto] items-center gap-2 rounded-lg border border-drift-line bg-[var(--drift-ui-surface)] p-2 max-[619px]:grid-cols-2 max-[519px]:grid-cols-1"
                  : `drift-theme-transition grid min-w-0 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-3 py-2 max-[519px]:grid-cols-[36px_minmax(0,1fr)] ${
                      isDragSource
                        ? "border-drift-signal bg-drift-raised opacity-60"
                        : `border-drift-line bg-[var(--drift-ui-surface)] ${
                            // 关掉提醒的行只变淡，开播状态照常显示：开关管的是「提不提醒」，
                            // 不是「要不要看」。
                            room.isEnabled ? "" : "opacity-60"
                          }`
                    }`
              }
              data-room-enabled={room.isEnabled ? "true" : "false"}
              draggable={!isEditing}
              key={room.id}
              onDragEnd={() => {
                setDragSourceId(null);
                onDragRoomEnd();
              }}
              onDragOver={(event) => {
                if (isEditing) {
                  return;
                }
                event.preventDefault();
              }}
              onDragStart={(event) => {
                const dataTransfer = event.dataTransfer;
                if (dataTransfer) {
                  dataTransfer.effectAllowed = "move";
                  dataTransfer.setData("text/plain", room.id);
                }
                setDragSourceId(room.id);
                onDragRoomStart(room.id);
              }}
              onDrop={(event) => {
                const source = dragSourceId;
                setDragSourceId(null);
                onDragRoomEnd();
                if (isEditing || !source || source === room.id) {
                  return;
                }
                event.preventDefault();
                void onMoveRoom(source, room.id);
              }}
            >
              {isEditing && editingSavedRoom ? (
                <>
                  <Input
                    aria-label="直播间名称"
                    inputSize="sm"
                    onChange={(event) =>
                      onEditRoomChange({
                        ...editingSavedRoom,
                        displayName: event.currentTarget.value,
                      })
                    }
                    value={editingSavedRoom.displayName}
                  />
                  <Input
                    aria-label="房间号"
                    inputSize="sm"
                    onChange={(event) =>
                      onEditRoomChange({
                        ...editingSavedRoom,
                        roomId: event.currentTarget.value,
                      })
                    }
                    placeholder="房间号或直播间链接"
                    value={editingSavedRoom.roomId}
                  />
                  <div
                    aria-label="分组"
                    className="flex min-w-0 flex-wrap items-center gap-1"
                  >
                    {groups.length === 0 ? (
                      <span className="text-[10px] text-[var(--drift-ui-muted)]">
                        不分组
                      </span>
                    ) : (
                      groups.map((group) => {
                        const selected = editingSavedRoom.groupIds.includes(
                          group.id,
                        );
                        return (
                          <button
                            aria-pressed={selected}
                            className={
                              selected
                                ? "drift-theme-transition rounded-full border border-drift-signal bg-drift-raised px-1.5 py-0.5 text-[9px] font-bold text-drift-ink"
                                : "drift-theme-transition rounded-full border border-drift-line px-1.5 py-0.5 text-[9px] font-bold text-[var(--drift-ui-muted)]"
                            }
                            key={group.id}
                            onClick={() =>
                              onEditRoomChange({
                                ...editingSavedRoom,
                                groupIds: selected
                                  ? editingSavedRoom.groupIds.filter(
                                      (id) => id !== group.id,
                                    )
                                  : [...editingSavedRoom.groupIds, group.id],
                              })
                            }
                            type="button"
                          >
                            {group.name}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip content="保存">
                      <IconButton
                        aria-label="保存"
                        onClick={onSaveEditedRoom}
                        size="sm"
                        variant="primary"
                      >
                        <Check aria-hidden="true" size={14} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip content="取消">
                      <IconButton
                        aria-label="取消"
                        onClick={onStopEditRoom}
                        size="sm"
                      >
                        <X aria-hidden="true" size={14} />
                      </IconButton>
                    </Tooltip>
                  </div>
                </>
              ) : (
                <>
                  <RoomAvatar name={room.displayName} path={room.avatarPath} />
                  <div className="grid min-w-0 gap-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <strong className="drift-theme-transition truncate text-[11px] text-drift-ink">
                        {room.displayName}
                      </strong>
                      {liveText ? (
                        <span
                          className={`drift-theme-transition shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${liveStateBadgeClass(room.liveState)}`}
                        >
                          {liveText}
                        </span>
                      ) : null}
                      {liveDuration ? (
                        <span
                          className="drift-theme-transition shrink-0 rounded-full border border-drift-signal bg-[var(--drift-ui-raised)] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--drift-ui-signal-text)]"
                          title={`已开播 ${liveDuration}`}
                        >
                          {liveDuration}
                        </span>
                      ) : null}
                      {session ? (
                        <span
                          className={`drift-theme-transition shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sessionBadgeClass(session.status)}`}
                        >
                          {sessionStatusText(session)}
                        </span>
                      ) : null}
                      {room.liveTitle ? (
                        // 直播标题吃掉这一行剩下的空白：开播时是当前标题（深色），
                        // 未开播时是 B 站保留的上次标题（灰色，一眼能分辨）。
                        <span
                          className={`drift-theme-transition min-w-0 flex-1 truncate text-[10px] ${
                            room.liveState === "live"
                              ? "text-drift-ink"
                              : "text-[var(--drift-ui-muted)]"
                          }`}
                        >
                          {room.liveTitle}
                        </span>
                      ) : null}
                    </div>
                    <span className="drift-data-text drift-theme-transition truncate text-[9px] text-[var(--drift-ui-muted)]">
                      {formatRoomMeta(groups, room)}
                      {room.anchorName ? ` · ${room.anchorName}` : ""}
                    </span>
                    {room.lastError ? (
                      <span className="drift-theme-transition truncate text-[9px] text-[var(--drift-ui-danger)]">
                        {room.lastError}
                      </span>
                    ) : null}
                    {commandError ? (
                      <span
                        className="drift-theme-transition text-[9px] text-[var(--drift-ui-danger)]"
                        role="alert"
                      >
                        {commandError}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1 max-[519px]:col-span-2">
                    <Toggle
                      aria-label={`开播提醒 ${room.displayName}`}
                      checked={room.isEnabled}
                      className="mr-1"
                      onCheckedChange={(checked) =>
                        void onToggleRoomEnabled(room, checked)
                      }
                    />
                    {active && session ? (
                      <Button
                        aria-label={`断开房间 ${room.roomId}`}
                        onClick={() => void onDisconnectSession(session.sessionId)}
                        size="sm"
                        variant="danger"
                      >
                        断开
                      </Button>
                    ) : session ? (
                      <Button
                        aria-label={`重试房间 ${room.roomId}`}
                        onClick={() => void onRetrySession(session)}
                        size="sm"
                        variant="primary"
                      >
                        重试
                      </Button>
                    ) : (
                      <Button
                        aria-label={`连接房间 ${room.roomId}`}
                        onClick={() => void onConnectRoom(room)}
                        size="sm"
                        variant="primary"
                      >
                        连接
                      </Button>
                    )}
                    <Tooltip content="在浏览器打开直播间">
                      <IconButton
                        aria-label={`打开直播间 ${room.roomId}`}
                        onClick={() =>
                          void openExternalUrl(bilibiliRoomUrl(room.roomId)).catch(
                            () => undefined,
                          )
                        }
                        size="sm"
                      >
                        <ExternalLink aria-hidden="true" size={13} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip content="修改">
                      <IconButton
                        aria-label="修改"
                        onClick={() => onStartEditRoom(room)}
                        size="sm"
                      >
                        <Pencil aria-hidden="true" size={13} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip content="删除">
                      <IconButton
                        aria-label="删除"
                        onClick={() => onDeleteRoom(room.id)}
                        size="sm"
                        variant="danger"
                      >
                        <Trash2 aria-hidden="true" size={13} />
                      </IconButton>
                    </Tooltip>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

export function liveStateText(state: LiveState): string | null {
  switch (state) {
    case "live":
      return "直播中";
    case "offline":
      return "未开播";
    // 既没查到结果（unknown）也没查成功（error）时保持静默，不再显示
    // 「等待检查」「检查失败」——那是后台检查的内部状态，不该占用户的卡片位置。
    case "error":
    case "unknown":
    default:
      return null;
  }
}

/** 关注列表行上的圆头像：没缓存或加载失败时退回名字首字。 */
export function RoomAvatar({ name, path }: { name: string; path?: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = avatarSrc(path);
  return (
    <span className="drift-theme-transition grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--drift-ui-selected)] text-[13px] font-semibold text-[var(--drift-ui-ink-soft)]">
      {src && !failed ? (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          src={src}
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}

/** 直播状态文字徽章（比原来的小圆点更容易看懂）。 */
function liveStateBadgeClass(state: LiveState) {
  switch (state) {
    case "live":
      return "bg-[#ffe9ef] text-[#fb7299]";
    case "error":
      return "bg-[rgba(229,72,77,0.12)] text-[var(--drift-ui-danger)]";
    case "offline":
      return "bg-[var(--drift-ui-hover)] text-[var(--drift-ui-muted)]";
    case "unknown":
    default:
      return "bg-[var(--drift-ui-surface)] text-[var(--drift-ui-subtle)]";
  }
}

/** 弹幕会话状态徽章（已连接 / 连接中 / 失败）。 */
function sessionBadgeClass(status: RoomSessionSnapshot["status"]) {
  switch (status) {
    case "connected":
      return "bg-[rgba(14,153,173,0.14)] text-[var(--drift-ui-signal-text)]";
    case "error":
    case "invalid_room":
      return "bg-[rgba(229,72,77,0.12)] text-[var(--drift-ui-danger)]";
    default:
      return "bg-[var(--drift-ui-hover)] text-[var(--drift-ui-muted)]";
  }
}

function formatRoomMeta(groups: SavedRoomGroup[], room: SavedRoom) {
  const groupNames = room.groupIds
    .map((groupId) => groups.find((group) => group.id === groupId)?.name)
    .filter((name): name is string => Boolean(name));
  return groupNames.length > 0
    ? `${room.roomId} / ${groupNames.join("、")}`
    : room.roomId;
}
