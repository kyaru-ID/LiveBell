import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  DEFAULT_APP_CONFIG,
  MAX_SAVED_ROOMS,
  UNGROUPED_SAVED_ROOM_GROUP_ID,
  type AppConfig,
  type SavedRoom,
} from "../../types/config";
import type { AppConfigUpdater } from "./useControlConfig";
import { useSavedRooms } from "./useSavedRooms";

test("saving a temporary room does not select it", async () => {
  const config: AppConfig = {
    ...DEFAULT_APP_CONFIG,
    selectedSavedRoomIds: ["existing"],
  };
  const saveConfig = vi.fn(async (_updater: AppConfigUpdater) => undefined);
  const { result } = renderHook(() =>
    useSavedRooms({
      config,
      draftRoomId: "",
      saveConfig,
    }),
  );

  await act(() => result.current.saveRoom("9", "临时主播"));

  const updater = saveConfig.mock.calls[0][0];
  const next = updater(config);
  expect(next.savedRooms[0]).toMatchObject({
    roomId: "9",
    displayName: "临时主播",
    anchorName: "临时主播",
  });
  expect(next.selectedSavedRoomIds).toEqual(["existing"]);
});

function savedRoom(index: number, groupIds: string[] = []): SavedRoom {
  return {
    id: `room-${index}`,
    roomId: String(100000 + index),
    displayName: `房间 ${index}`,
    groupIds,
    order: index,
    isEnabled: true,
    liveState: "unknown",
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

function renderSavedRooms(config: AppConfig) {
  let state = config;
  const saveConfig = vi.fn(async (updater: AppConfigUpdater) => {
    state = updater(state);
  });
  const view = renderHook(() =>
    useSavedRooms({ config, draftRoomId: "", saveConfig }),
  );

  return { ...view, saveConfig, state: () => state };
}

test("saves a live room link with the parsed room id", async () => {
  const { result, state } = renderSavedRooms({
    ...DEFAULT_APP_CONFIG,
    savedRooms: [],
  });

  await act(() =>
    result.current.saveRoom("https://live.bilibili.com/123456"),
  );

  expect(state().savedRooms).toHaveLength(1);
  expect(state().savedRooms[0].roomId).toBe("123456");
  expect(state().savedRooms[0].displayName).toBe("房间 123456");
  expect(state().savedRooms[0].liveState).toBe("unknown");
});

test("rejects an input that is neither a room id nor a live link", async () => {
  const { result, saveConfig } = renderSavedRooms({
    ...DEFAULT_APP_CONFIG,
    savedRooms: [],
  });

  await act(() => result.current.saveRoom("直播间链接：不是数字"));

  expect(result.current.savedRoomError).toBe(
    "请输入有效房间号或 live.bilibili.com 链接。",
  );
  expect(saveConfig).not.toHaveBeenCalled();
});

test("refuses a new room once the fifty room limit is reached", async () => {
  const rooms = Array.from({ length: MAX_SAVED_ROOMS }, (_, index) =>
    savedRoom(index),
  );
  const { result, saveConfig } = renderSavedRooms({
    ...DEFAULT_APP_CONFIG,
    savedRooms: rooms,
  });

  await act(() => result.current.saveRoom("999999"));

  expect(result.current.savedRoomError).toBe(
    `第一版最多支持同时关注 ${MAX_SAVED_ROOMS} 位主播。`,
  );
  expect(saveConfig).not.toHaveBeenCalled();
});

test("reorders every room after a drag move", async () => {
  const { result, state } = renderSavedRooms({
    ...DEFAULT_APP_CONFIG,
    savedRooms: [savedRoom(1), savedRoom(2), savedRoom(3)],
  });

  await act(() => result.current.moveSavedRoom("room-3", "room-1"));

  const orderById = new Map(
    state().savedRooms.map((room) => [room.id, room.order]),
  );
  expect(orderById.get("room-3")).toBe(0);
  expect(orderById.get("room-1")).toBe(1);
  expect(orderById.get("room-2")).toBe(2);
});

test("drops duplicate and unknown group ids", async () => {
  const { result, state } = renderSavedRooms({
    ...DEFAULT_APP_CONFIG,
    savedRooms: [savedRoom(1)],
  });

  await act(() =>
    result.current.setSavedRoomGroupIds("room-1", ["chat", "chat", "unknown"]),
  );

  expect(state().savedRooms[0].groupIds).toEqual(["chat"]);
});

test("toggles the follow switch and filters by group tab", async () => {
  const { result, state } = renderSavedRooms({
    ...DEFAULT_APP_CONFIG,
    savedRooms: [savedRoom(1, ["chat"]), savedRoom(2)],
  });

  expect(result.current.filteredSavedRooms.map((room) => room.id)).toEqual([
    "room-1",
    "room-2",
  ]);

  await act(() =>
    result.current.setSelectedSavedRoomGroupId(UNGROUPED_SAVED_ROOM_GROUP_ID),
  );
  expect(result.current.filteredSavedRooms.map((room) => room.id)).toEqual([
    "room-2",
  ]);

  await act(() => result.current.setSelectedSavedRoomGroupId("chat"));
  expect(result.current.filteredSavedRooms.map((room) => room.id)).toEqual([
    "room-1",
  ]);

  await act(() => result.current.setSavedRoomEnabled("room-1", false));
  expect(
    state().savedRooms.find((room) => room.id === "room-1")?.isEnabled,
  ).toBe(false);
});
