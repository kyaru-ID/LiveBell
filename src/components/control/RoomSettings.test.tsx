import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import {
  ALL_SAVED_ROOM_GROUP_ID,
  DEFAULT_APP_CONFIG,
} from "../../types/config";
import type { RoomSessionSnapshot } from "../../types/roomSession";
import { RoomSettings } from "./RoomSettings";

afterEach(clearMocks);

function renderRoomSettings({
  sessions = [],
  temporarySessions = [],
}: {
  sessions?: RoomSessionSnapshot[];
  temporarySessions?: RoomSessionSnapshot[];
} = {}) {
  const callbacks = {
    onConnectDraftRoom: vi.fn(),
    onConnectSavedRoom: vi.fn(),
    onCreateGroup: vi.fn(async () => true),
    onDeleteGroup: vi.fn(async () => true),
    onDeleteRoom: vi.fn(),
    onDisconnectSession: vi.fn(),
    onDropRoomToGroup: vi.fn(),
    onEditRoomChange: vi.fn(),
    onGroupChange: vi.fn(),
    onMoveRoom: vi.fn(),
    onRenameGroup: vi.fn(async () => true),
    onRetrySession: vi.fn(),
    onRoomIdChange: vi.fn(),
    onSaveCurrentRoom: vi.fn(),
    onSaveEditedRoom: vi.fn(),
    onSaveTemporaryRoom: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onStartEditRoom: vi.fn(),
    onStopEditRoom: vi.fn(),
    onToggleRoomEnabled: vi.fn(),
  };

  const view = render(
    <RoomSettings
      commandErrors={{}}
      config={DEFAULT_APP_CONFIG}
      draftRoomId="123456"
      editingSavedRoom={null}
      filteredSavedRooms={[]}
      savedRoomError=""
      savedRoomSearchQuery=""
      selectedGroupId={ALL_SAVED_ROOM_GROUP_ID}
      selectionError=""
      sessions={sessions}
      snapshotError=""
      temporarySessions={temporarySessions}
      {...callbacks}
    />,
  );

  return { ...view, ...callbacks };
}

test("keeps the help command and always-available temporary connection", async () => {
  const commands: Array<{ command: string; payload: unknown }> = [];
  mockIPC((command, payload) => {
    commands.push({ command, payload });
    return null;
  });
  const user = userEvent.setup();
  const { onConnectDraftRoom } = renderRoomSettings({
    sessions: [
      {
        sessionId: "s-1",
        requestedRoomId: 6,
        roomId: 6,
        status: "connected",
        message: "已连接",
      },
    ],
  });

  expect(
    screen.getByPlaceholderText("输入房间号或直播间链接"),
  ).toBeEnabled();
  expect(
    screen.queryByText("输入房间只连接本次运行，不自动保存或加入已选集合"),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "如何获取房间号" }));
  await user.click(screen.getByRole("button", { name: "连接" }));

  expect(commands).toContainEqual({ command: "open_help_window", payload: {} });
  expect(onConnectDraftRoom).toHaveBeenCalledOnce();
});

test("summarizes room sessions without its own disconnect action", () => {
  renderRoomSettings({
    sessions: [
      {
        sessionId: "s-1",
        requestedRoomId: 6,
        roomId: 6,
        status: "connected",
        message: "已连接",
      },
      {
        sessionId: "s-2",
        requestedRoomId: 7,
        status: "not_live",
        message: "未开播",
      },
    ],
  });

  expect(screen.getByText("已连接 1 · 未开播 1")).toBeVisible();
  // 用户要求「全部断开」只留在主界面分组条那一行，设置页不再重复一个。
  expect(
    screen.queryByRole("button", { name: "全部断开" }),
  ).not.toBeInTheDocument();
});

test("renders temporary sessions only when present", () => {
  const temporary: RoomSessionSnapshot = {
    sessionId: "temp-9",
    requestedRoomId: 9,
    roomId: 9,
    status: "connected",
    message: "已连接",
  };
  const { unmount } = renderRoomSettings();
  expect(screen.queryByRole("region", { name: "临时连接" })).toBeNull();
  unmount();

  renderRoomSettings({ sessions: [temporary], temporarySessions: [temporary] });
  expect(screen.getByRole("region", { name: "临时连接" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "保存房间 9 为常用" }),
  ).toBeVisible();
});

