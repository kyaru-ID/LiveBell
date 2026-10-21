import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, SavedRoom } from "../../types/config";
import type { RoomSessionSnapshot } from "../../types/roomSession";
import { Button, Input, IconButton } from "../ui";
import { RoomSessionList } from "./RoomSessionList";
import { SavedRoomGroupControls } from "./SavedRoomGroupControls";
import { SavedRoomList, type EditingSavedRoom } from "./SavedRoomList";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
  StatusBanner,
} from "./settings-ui";

type RoomSettingsProps = {
  commandErrors: Record<string, string>;
  config: AppConfig;
  draftRoomId: string;
  editingSavedRoom: EditingSavedRoom | null;
  filteredSavedRooms: SavedRoom[];
  onConnectDraftRoom: () => void | Promise<void>;
  onConnectSavedRoom: (room: SavedRoom) => void | Promise<void>;
  onCreateGroup: (name: string) => Promise<boolean>;
  onDeleteGroup: (groupId: string) => Promise<boolean>;
  onDeleteRoom: (roomId: string) => void;
  onDisconnectSession: (sessionId: string) => void | Promise<void>;
  onDropRoomToGroup: (
    savedRoomId: string,
    groupId: string,
  ) => void | Promise<void>;
  onEditRoomChange: (room: EditingSavedRoom) => void;
  onGroupChange: (groupId: string) => void;
  onMoveRoom: (
    sourceSavedRoomId: string,
    targetSavedRoomId: string,
  ) => void | Promise<void>;
  onRenameGroup: (groupId: string, name: string) => Promise<boolean>;
  onRetrySession: (session: RoomSessionSnapshot) => void | Promise<void>;
  onRoomIdChange: (roomId: string) => void;
  onSaveCurrentRoom: () => void;
  onSaveEditedRoom: () => void;
  onSaveTemporaryRoom: (session: RoomSessionSnapshot) => void | Promise<void>;
  onSearchQueryChange: (query: string) => void;
  onStartEditRoom: (room: SavedRoom) => void;
  onStopEditRoom: () => void;
  onToggleRoomEnabled: (
    room: SavedRoom,
    enabled: boolean,
  ) => void | Promise<void>;
  savedRoomError: string;
  savedRoomSearchQuery: string;
  selectedGroupId: string;
  selectionError: string;
  sessions: RoomSessionSnapshot[];
  snapshotError: string;
  temporarySessions: RoomSessionSnapshot[];
};

export function RoomSettings({
  commandErrors,
  config,
  draftRoomId,
  editingSavedRoom,
  filteredSavedRooms,
  onConnectDraftRoom,
  onConnectSavedRoom,
  onCreateGroup,
  onDeleteGroup,
  onDeleteRoom,
  onDisconnectSession,
  onDropRoomToGroup,
  onEditRoomChange,
  onGroupChange,
  onMoveRoom,
  onRenameGroup,
  onRetrySession,
  onRoomIdChange,
  onSaveCurrentRoom,
  onSaveEditedRoom,
  onSaveTemporaryRoom,
  onSearchQueryChange,
  onStartEditRoom,
  onStopEditRoom,
  onToggleRoomEnabled,
  savedRoomError,
  savedRoomSearchQuery,
  selectedGroupId,
  selectionError,
  sessions,
  snapshotError,
  temporarySessions,
}: RoomSettingsProps) {
  const [draggedRoomId, setDraggedRoomId] = useState<string | null>(null);

  return (
    <SettingsPage>
      <SettingsSection
        description={roomSessionSummary(sessions)}
        title="连接"
      >
        <SettingsRow
          control={
            <div className="grid min-w-[360px] grid-cols-[minmax(0,1fr)_28px_112px] gap-2 max-[619px]:min-w-[280px] max-[519px]:min-w-0 max-[519px]:grid-cols-[minmax(0,1fr)_28px]">
              <Input
                id="control-room-id"
                inputMode="numeric"
                onChange={(event) => onRoomIdChange(event.currentTarget.value)}
                placeholder="输入房间号或直播间链接"
                value={draftRoomId}
              />
              <IconButton
                aria-label="如何获取房间号"
                onClick={() => invoke("open_help_window")}
                size="sm"
                title="如何获取房间号"
                variant="ghost"
              >
                ?
              </IconButton>
              <Button
                className="max-[519px]:col-span-2"
                disabled={!draftRoomId.trim()}
                onClick={() => void onConnectDraftRoom()}
              >
                连接
              </Button>
            </div>
          }
          htmlFor="control-room-id"
          label="房间号"
        />
        {snapshotError || commandErrors.draft ? (
          <div className="grid gap-2 border-t border-drift-line p-3">
            {snapshotError ? (
              <StatusBanner
                description={snapshotError}
                title="房间会话状态不可用"
                tone="danger"
              />
            ) : null}
            {commandErrors.draft ? (
              <StatusBanner
                description={commandErrors.draft}
                title="临时房间连接失败"
                tone="danger"
              />
            ) : null}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        actions={
          <Button
            disabled={!draftRoomId.trim()}
            onClick={onSaveCurrentRoom}
            size="sm"
          >
            保存当前直播间
          </Button>
        }
        description={`${filteredSavedRooms.length} 个`}
        title="常用直播间"
      >
        <div className="grid min-h-0 gap-2 p-3">
          <SavedRoomGroupControls
            draggedRoomId={draggedRoomId}
            groups={config.savedRoomGroups}
            onCreateGroup={onCreateGroup}
            onDeleteGroup={onDeleteGroup}
            onDropRoomToGroup={onDropRoomToGroup}
            onRenameGroup={onRenameGroup}
            onSearchQueryChange={onSearchQueryChange}
            onSelectedGroupChange={onGroupChange}
            searchQuery={savedRoomSearchQuery}
            selectedGroupId={selectedGroupId}
          />
          {savedRoomError || selectionError ? (
            <StatusBanner
              description={savedRoomError || selectionError}
              title="常用直播间操作失败"
              tone="danger"
            />
          ) : null}
          <SavedRoomList
            commandErrors={commandErrors}
            editingSavedRoom={editingSavedRoom}
            groups={config.savedRoomGroups}
            onConnectRoom={onConnectSavedRoom}
            onDeleteRoom={onDeleteRoom}
            onDisconnectSession={onDisconnectSession}
            onDragRoomEnd={() => setDraggedRoomId(null)}
            onDragRoomStart={setDraggedRoomId}
            onEditRoomChange={onEditRoomChange}
            onMoveRoom={onMoveRoom}
            onRetrySession={onRetrySession}
            onSaveEditedRoom={onSaveEditedRoom}
            onStartEditRoom={onStartEditRoom}
            onStopEditRoom={onStopEditRoom}
            onToggleRoomEnabled={onToggleRoomEnabled}
            rooms={filteredSavedRooms}
            sessions={sessions}
            showLiveDuration={config.notification.showLiveDuration}
          />
        </div>
      </SettingsSection>

      {temporarySessions.length > 0 ? (
        <SettingsSection
          description="未匹配当前常用直播间，只保留到本次运行结束"
          title="临时连接"
        >
          <RoomSessionList
            commandErrors={commandErrors}
            onDisconnectSession={onDisconnectSession}
            onRetrySession={onRetrySession}
            onSaveRoom={onSaveTemporaryRoom}
            sessions={temporarySessions}
          />
        </SettingsSection>
      ) : null}
    </SettingsPage>
  );
}

function roomSessionSummary(sessions: RoomSessionSnapshot[]) {
  if (sessions.length === 0) return "尚未连接直播间";
  const labels: Array<[RoomSessionSnapshot["status"], string]> = [
    ["connected", "已连接"],
    ["connecting", "连接中"],
    ["reconnecting", "重连中"],
    ["not_live", "未开播"],
    ["invalid_room", "房间号不存在"],
    ["error", "连接失败"],
    ["disconnected", "已断开"],
  ];
  return labels
    .map(([status, label]) => {
      const count = sessions.filter((session) => session.status === status).length;
      return count > 0 ? `${label} ${count}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

