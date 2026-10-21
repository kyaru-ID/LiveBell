import { useEffect, useMemo, useState } from "react";
import type { EditingSavedRoom } from "../../components/control/SavedRoomList";
import {
  ALL_SAVED_ROOM_GROUP_ID,
  MAX_SAVED_ROOMS,
  UNGROUPED_SAVED_ROOM_GROUP_ID,
  dedupeSavedRoomGroupIds,
  type AppConfig,
  type SavedRoomGroup,
  type SavedRoom,
} from "../../types/config";
import { roomIdFromInput } from "../../utils/roomId";
import type { AppConfigUpdater } from "./useControlConfig";

type UseSavedRoomsParams = {
  config: AppConfig;
  /** 主界面输入框里的草稿房间号；独立窗口不再用它保存，可以不传。 */
  draftRoomId?: string;
  saveConfig: (updater: AppConfigUpdater) => Promise<void>;
};

export function useSavedRooms({
  config,
  draftRoomId,
  saveConfig,
}: UseSavedRoomsParams) {
  const [editingSavedRoom, setEditingSavedRoom] =
    useState<EditingSavedRoom | null>(null);
  const [savedRoomError, setSavedRoomError] = useState("");
  const [selectedSavedRoomGroupId, setSelectedSavedRoomGroupId] = useState(
    ALL_SAVED_ROOM_GROUP_ID,
  );
  const [savedRoomSearchQuery, setSavedRoomSearchQuery] = useState("");

  const filteredSavedRooms = useMemo(
    () =>
      filterSavedRooms(
        config.savedRooms,
        selectedSavedRoomGroupId,
        savedRoomSearchQuery,
      ),
    [config.savedRooms, savedRoomSearchQuery, selectedSavedRoomGroupId],
  );

  useEffect(() => {
    if (
      selectedSavedRoomGroupId !== ALL_SAVED_ROOM_GROUP_ID &&
      // 「未分组」是虚拟页签，不存在于 savedRoomGroups，不能被重置回「全部」。
      selectedSavedRoomGroupId !== UNGROUPED_SAVED_ROOM_GROUP_ID &&
      !config.savedRoomGroups.some(
        (group) => group.id === selectedSavedRoomGroupId,
      )
    ) {
      setSelectedSavedRoomGroupId(ALL_SAVED_ROOM_GROUP_ID);
    }
  }, [config.savedRoomGroups, selectedSavedRoomGroupId]);

  async function saveCurrentRoom() {
    await saveRoom(draftRoomId ?? "");
  }

  async function saveRoom(rawRoomId: string, anchorName?: string) {
    const roomId = roomIdFromInput(rawRoomId);
    if (!roomId) {
      setSavedRoomError("请输入有效房间号或 live.bilibili.com 链接。");
      return;
    }
    if (
      !config.savedRooms.some((room) => room.roomId === roomId) &&
      config.savedRooms.length >= MAX_SAVED_ROOMS
    ) {
      setSavedRoomError(`第一版最多支持同时关注 ${MAX_SAVED_ROOMS} 位主播。`);
      return;
    }

    setSavedRoomError("");
    const now = new Date().toISOString();
    const roomName = anchorName?.trim();
    const displayName =
      roomName && roomName !== "未知" ? roomName : `房间 ${roomId}`;
    await saveConfig((current) => {
      const existingRoom = current.savedRooms.find(
        (room) => room.roomId === roomId,
      );
      const targetGroupIds = resolveDefaultSaveGroupIds(
        current,
        selectedSavedRoomGroupId,
      );
      const savedRooms = existingRoom
        ? current.savedRooms.map((room) =>
            room.id === existingRoom.id
              ? {
                  ...room,
                  anchorName: roomName || room.anchorName,
                  displayName: room.displayName || displayName,
                  updatedAt: now,
                }
              : room,
          )
        : [
            {
              id: createSavedRoomId(),
              roomId,
              displayName,
              anchorName: roomName,
              groupIds: targetGroupIds,
              order: nextSavedRoomOrder(current.savedRooms),
              isEnabled: true,
              liveState: "unknown" as const,
              updatedAt: now,
            },
            ...current.savedRooms,
          ];

      return { ...current, savedRooms };
    });
  }

  async function deleteSavedRoom(savedRoomId: string) {
    if (editingSavedRoom?.id === savedRoomId) {
      setEditingSavedRoom(null);
    }
    setSavedRoomError("");
    await saveConfig((current) => ({
      ...current,
      savedRooms: current.savedRooms.filter((room) => room.id !== savedRoomId),
      selectedSavedRoomIds: current.selectedSavedRoomIds.filter(
        (roomId) => roomId !== savedRoomId,
      ),
    }));
  }

  function startEditSavedRoom(room: SavedRoom) {
    setSavedRoomError("");
    setEditingSavedRoom({
      id: room.id,
      roomId: room.roomId,
      displayName: room.displayName,
      groupIds: resolveTargetGroupIds(config, room.groupIds),
    });
  }

  async function saveEditedRoom() {
    if (!editingSavedRoom) {
      return;
    }

    const roomId = roomIdFromInput(editingSavedRoom.roomId);
    const displayName = editingSavedRoom.displayName.trim();
    if (!displayName) {
      setSavedRoomError("名称不能为空");
      return;
    }
    if (!roomId) {
      setSavedRoomError("请输入有效房间号或 live.bilibili.com 链接。");
      return;
    }
    if (
      config.savedRooms.some(
        (room) => room.id !== editingSavedRoom.id && room.roomId === roomId,
      )
    ) {
      setSavedRoomError("该房间号已在常用直播间中");
      return;
    }

    setSavedRoomError("");
    await saveConfig((current) => ({
      ...current,
      savedRooms: current.savedRooms.map((room) =>
        room.id === editingSavedRoom.id
          ? {
              ...room,
              roomId,
              displayName,
              groupIds: resolveTargetGroupIds(
                current,
                editingSavedRoom.groupIds,
              ),
              updatedAt: new Date().toISOString(),
            }
          : room,
      ),
    }));
    setEditingSavedRoom(null);
  }

  async function createSavedRoomGroup(name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSavedRoomError("分组名称不能为空");
      return false;
    }
    if (hasDuplicateGroupName(config.savedRoomGroups, trimmedName)) {
      setSavedRoomError("分组名称已存在");
      return false;
    }

    const now = new Date().toISOString();
    const group: SavedRoomGroup = {
      id: createSavedRoomGroupId(),
      name: trimmedName,
      createdAt: now,
      updatedAt: now,
    };

    setSavedRoomError("");
    await saveConfig((current) => ({
      ...current,
      savedRoomGroups: [...current.savedRoomGroups, group],
    }));
    setSelectedSavedRoomGroupId(group.id);
    return true;
  }

  async function renameSavedRoomGroup(groupId: string, name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSavedRoomError("分组名称不能为空");
      return false;
    }
    if (hasDuplicateGroupName(config.savedRoomGroups, trimmedName, groupId)) {
      setSavedRoomError("分组名称已存在");
      return false;
    }
    if (!config.savedRoomGroups.some((group) => group.id === groupId)) {
      setSavedRoomError("分组不存在");
      return false;
    }

    const now = new Date().toISOString();
    setSavedRoomError("");
    await saveConfig((current) => ({
      ...current,
      savedRoomGroups: current.savedRoomGroups.map((group) =>
        group.id === groupId
          ? { ...group, name: trimmedName, updatedAt: now }
          : group,
      ),
    }));
    return true;
  }

  async function deleteSavedRoomGroup(groupId: string) {
    if (config.savedRoomGroups.length <= 1) {
      setSavedRoomError("至少保留一个分组");
      return false;
    }
    const groupExists = config.savedRoomGroups.some(
      (group) => group.id === groupId,
    );
    if (!groupExists) {
      setSavedRoomError("分组不存在");
      return false;
    }

    setSavedRoomError("");
    await saveConfig((current) => ({
      ...current,
      savedRoomGroups: current.savedRoomGroups.filter(
        (group) => group.id !== groupId,
      ),
      savedRooms: current.savedRooms.map((room) =>
        room.groupIds.includes(groupId)
          ? { ...room, groupIds: room.groupIds.filter((id) => id !== groupId) }
          : room,
      ),
    }));
    if (selectedSavedRoomGroupId === groupId) {
      setSelectedSavedRoomGroupId(ALL_SAVED_ROOM_GROUP_ID);
    }
    return true;
  }

  async function setSavedRoomEnabled(savedRoomId: string, enabled: boolean) {
    setSavedRoomError("");
    await saveConfig((current) => ({
      ...current,
      savedRooms: current.savedRooms.map((room) =>
        room.id === savedRoomId ? { ...room, isEnabled: enabled } : room,
      ),
    }));
  }

  async function setSavedRoomGroupIds(
    savedRoomId: string,
    groupIds: string[],
  ) {
    setSavedRoomError("");
    await saveConfig((current) => ({
      ...current,
      savedRooms: current.savedRooms.map((room) =>
        room.id === savedRoomId
          ? {
              ...room,
              groupIds: resolveTargetGroupIds(current, groupIds),
              updatedAt: new Date().toISOString(),
            }
          : room,
      ),
    }));
  }

  /** 把拖动的房间插到目标房间所在的位置，并按新顺序重排整份 order。 */
  async function moveSavedRoom(
    sourceSavedRoomId: string,
    targetSavedRoomId: string,
  ) {
    if (sourceSavedRoomId === targetSavedRoomId) {
      return;
    }

    setSavedRoomError("");
    await saveConfig((current) => {
      const ordered = [...current.savedRooms].sort(
        (left, right) => left.order - right.order,
      );
      const fromIndex = ordered.findIndex(
        (room) => room.id === sourceSavedRoomId,
      );
      const toIndex = ordered.findIndex(
        (room) => room.id === targetSavedRoomId,
      );
      if (fromIndex < 0 || toIndex < 0) {
        return current;
      }

      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(toIndex, 0, moved);
      const orderByRoomId = new Map(
        ordered.map((room, index) => [room.id, index]),
      );

      return {
        ...current,
        savedRooms: current.savedRooms.map((room) => ({
          ...room,
          order: orderByRoomId.get(room.id) ?? room.order,
        })),
      };
    });
  }

  return {
    createSavedRoomGroup,
    deleteSavedRoom,
    deleteSavedRoomGroup,
    editingSavedRoom,
    filteredSavedRooms,
    moveSavedRoom,
    renameSavedRoomGroup,
    savedRoomError,
    savedRoomSearchQuery,
    saveCurrentRoom,
    saveRoom,
    saveEditedRoom,
    selectedSavedRoomGroupId,
    setEditingSavedRoom,
    setSavedRoomEnabled,
    setSavedRoomGroupIds,
    setSavedRoomSearchQuery,
    setSelectedSavedRoomGroupId,
    startEditSavedRoom,
  };
}

function filterSavedRooms(
  rooms: SavedRoom[],
  selectedGroupId: string,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  return [...rooms]
    .sort((left, right) => left.order - right.order)
    .filter((room) => {
      if (!matchesSavedRoomGroup(room, selectedGroupId)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [room.roomId, room.displayName, room.anchorName ?? ""].some(
        (value) => value.toLowerCase().includes(normalizedQuery),
      );
    });
}

function matchesSavedRoomGroup(room: SavedRoom, selectedGroupId: string) {
  if (selectedGroupId === ALL_SAVED_ROOM_GROUP_ID) {
    return true;
  }
  if (selectedGroupId === UNGROUPED_SAVED_ROOM_GROUP_ID) {
    return room.groupIds.length === 0;
  }
  return room.groupIds.includes(selectedGroupId);
}

function nextSavedRoomOrder(rooms: SavedRoom[]) {
  if (rooms.length === 0) {
    return 0;
  }
  return Math.min(...rooms.map((room) => room.order)) - 1;
}

function resolveTargetGroupIds(config: AppConfig, groupIds: string[]) {
  const validGroupIds = new Set(config.savedRoomGroups.map((group) => group.id));
  return dedupeSavedRoomGroupIds(groupIds, validGroupIds);
}

function resolveDefaultSaveGroupIds(
  config: AppConfig,
  selectedGroupId: string,
): string[] {
  if (
    selectedGroupId !== ALL_SAVED_ROOM_GROUP_ID &&
    selectedGroupId !== UNGROUPED_SAVED_ROOM_GROUP_ID &&
    config.savedRoomGroups.some((group) => group.id === selectedGroupId)
  ) {
    return [selectedGroupId];
  }

  return [];
}

function hasDuplicateGroupName(
  groups: SavedRoomGroup[],
  name: string,
  ignoredGroupId?: string,
) {
  return groups.some(
    (group) => group.id !== ignoredGroupId && group.name === name,
  );
}

function createSavedRoomGroupId() {
  return `group-${createSavedRoomId()}`;
}

function createSavedRoomId() {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

