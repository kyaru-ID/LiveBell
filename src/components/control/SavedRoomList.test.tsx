import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openExternalUrl } from "../../utils/openExternal";
import { expect, test, vi } from "vitest";
import type { SavedRoom, SavedRoomGroup } from "../../types/config";
import type { RoomSessionSnapshot } from "../../types/roomSession";
import { SavedRoomList, type EditingSavedRoom } from "./SavedRoomList";

vi.mock("../../utils/openExternal", () => ({
  openExternalUrl: vi.fn(async () => undefined),
}));

const GROUPS: SavedRoomGroup[] = [
  {
    id: "chat",
    name: "聊天",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  },
];

const ROOM: SavedRoom = {
  id: "room-1",
  roomId: "123456",
  displayName: "深夜电台",
  anchorName: "示例主播",
  groupIds: ["chat"],
  order: 0,
  isEnabled: true,
  liveState: "unknown",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

function renderSavedRoomList(
  rooms: SavedRoom[],
  editingSavedRoom: EditingSavedRoom | null = null,
  sessions: RoomSessionSnapshot[] = [],
  showLiveDuration = true,
) {
  const callbacks = {
    onConnectRoom: vi.fn(),
    onDeleteRoom: vi.fn(),
    onDisconnectSession: vi.fn(),
    onDragRoomEnd: vi.fn(),
    onDragRoomStart: vi.fn(),
    onEditRoomChange: vi.fn(),
    onMoveRoom: vi.fn(),
    onRetrySession: vi.fn(),
    onSaveEditedRoom: vi.fn(),
    onStartEditRoom: vi.fn(),
    onStopEditRoom: vi.fn(),
    onToggleRoomEnabled: vi.fn(),
  };

  render(
    <SavedRoomList
      editingSavedRoom={editingSavedRoom}
      groups={GROUPS}
      commandErrors={{}}
      rooms={rooms}
      sessions={sessions}
      showLiveDuration={showLiveDuration}
      {...callbacks}
    />,
  );

  return callbacks;
}

test("renders the migrated empty state", () => {
  renderSavedRoomList([]);

  expect(screen.getByText("暂无常用直播间")).toBeVisible();
  expect(screen.getByText("输入房间号后保存到这里。")).toBeVisible();
});

test("selects without connecting and keeps connect, edit, and delete callbacks", async () => {
  const user = userEvent.setup();
  const callbacks = renderSavedRoomList([ROOM]);

  expect(screen.getByText("深夜电台").closest(".rounded-lg")).toHaveClass(
    "drift-theme-transition",
    "bg-[var(--drift-ui-surface)]",
  );

  await user.click(screen.getByRole("button", { name: "连接房间 123456" }));
  await user.click(screen.getByRole("button", { name: "修改" }));
  await user.click(screen.getByRole("button", { name: "删除" }));

  expect(callbacks.onConnectRoom).toHaveBeenCalledWith(ROOM);
  expect(callbacks.onStartEditRoom).toHaveBeenCalledWith(ROOM);
  expect(callbacks.onDeleteRoom).toHaveBeenCalledWith("room-1");
});

test("shows matching session state and the appropriate row action", async () => {
  const user = userEvent.setup();
  const connected: RoomSessionSnapshot = {
    sessionId: "s-1",
    requestedRoomId: 123456,
    roomId: 123456,
    status: "connected",
    message: "已连接",
  };
  const callbacks = renderSavedRoomList([ROOM], null, [connected]);

  expect(screen.getByText("已连接")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "连接房间 123456" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "断开房间 123456" }),
  );

  expect(callbacks.onDisconnectSession).toHaveBeenCalledWith("s-1");
});

test("keeps edited room fields and save or cancel actions", async () => {
  const user = userEvent.setup();
  const editingSavedRoom: EditingSavedRoom = {
    displayName: "深夜电台",
    groupIds: ["chat"],
    id: "room-1",
    roomId: "123456",
  };
  const callbacks = renderSavedRoomList([ROOM], editingSavedRoom);

  fireEvent.change(screen.getByRole("textbox", { name: "直播间名称" }), {
    target: { value: "午夜电台" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "房间号" }), {
    target: { value: "654321" },
  });
  await user.click(screen.getByRole("button", { name: "保存" }));
  await user.click(screen.getByRole("button", { name: "取消" }));

  expect(callbacks.onEditRoomChange).toHaveBeenCalledWith({
    ...editingSavedRoom,
    displayName: "午夜电台",
  });
  expect(callbacks.onEditRoomChange).toHaveBeenCalledWith({
    ...editingSavedRoom,
    roomId: "654321",
  });
  expect(callbacks.onSaveEditedRoom).toHaveBeenCalledOnce();
  expect(callbacks.onStopEditRoom).toHaveBeenCalledOnce();
});

const LIVE_ROOM: SavedRoom = {
  id: "room-2",
  roomId: "654321",
  displayName: "午后闲聊",
  groupIds: [],
  order: 1,
  isEnabled: false,
  liveState: "live",
  liveTitle: "今天的直播",
  lastCheckedAt: "2026-08-17T12:34:56.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

test("shows live state and live title without the background check time", () => {
  renderSavedRoomList([LIVE_ROOM]);

  expect(screen.getByText("直播中")).toBeVisible();
  expect(screen.getByText("今天的直播")).toBeVisible();
  // 开播检查是后台内部细节，卡片上不再出现「检测 时间」。
  expect(screen.queryByText(/检测/)).toBeNull();
});

test("shows the last live title on an offline row", () => {
  // B 站在主播未开播时仍会返回上次的直播标题，卡片把它显示在状态徽章右边的空白处。
  renderSavedRoomList([
    { ...LIVE_ROOM, id: "room-3", roomId: "777777", liveState: "offline" },
  ]);

  expect(screen.getByText("未开播")).toBeVisible();
  expect(screen.getByText("今天的直播")).toBeVisible();
});

test("toggles follow enabled state and opens the live room", async () => {
  const user = userEvent.setup();
  const callbacks = renderSavedRoomList([ROOM]);

  await user.click(screen.getByRole("switch", { name: "开播提醒 深夜电台" }));
  expect(callbacks.onToggleRoomEnabled).toHaveBeenCalledWith(ROOM, false);

  await user.click(screen.getByRole("button", { name: "打开直播间 123456" }));
  expect(vi.mocked(openExternalUrl)).toHaveBeenCalledWith(
    "https://live.bilibili.com/123456",
  );
});

test("keeps showing live state on a row without live reminders", () => {
  renderSavedRoomList([LIVE_ROOM]);

  const row = screen.getByText("午后闲聊").closest("[draggable]");
  expect(row).not.toBeNull();
  // 开关只管提醒不管查看：关掉提醒的行照样显示开播状态，只是整行变淡。
  expect(screen.getByText("直播中")).toBeVisible();
  expect(screen.getByText("今天的直播")).toBeVisible();
  expect(row!.className).toContain("opacity-60");
  expect(screen.getByRole("switch", { name: "开播提醒 午后闲聊" })).toBeVisible();
});

test("keeps a row with live reminders at full opacity", () => {
  renderSavedRoomList([{ ...ROOM, liveState: "live" }]);

  const row = screen.getByText("深夜电台").closest("[draggable]");
  expect(row).not.toBeNull();
  expect(screen.getByText("直播中")).toBeVisible();
  expect(row!.className).not.toContain("opacity-60");
});

test("shows how long the room has been live", () => {
  renderSavedRoomList([
    {
      ...LIVE_ROOM,
      // 23 分 30 秒前开播：分钟数按向下取整显示。
      liveStartedAt: new Date(Date.now() - (23 * 60 + 30) * 1000).toISOString(),
    },
  ]);

  expect(screen.getByText("23 分钟")).toBeVisible();
});

test("hides the live duration when the setting is off", () => {
  renderSavedRoomList(
    [
      {
        ...LIVE_ROOM,
        liveStartedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    ],
    null,
    [],
    false,
  );

  expect(screen.queryByText("10 分钟")).toBeNull();
  expect(screen.getByText("直播中")).toBeVisible();
});

test("does not show a stale start time on an offline row", () => {
  renderSavedRoomList([
    {
      ...LIVE_ROOM,
      liveState: "offline",
      liveStartedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    },
  ]);

  expect(screen.queryByText("10 分钟")).toBeNull();
});

test("moves a dragged room onto another row", () => {
  const callbacks = renderSavedRoomList([ROOM, LIVE_ROOM]);
  const source = screen.getByText("深夜电台").closest("[draggable]");
  const target = screen.getByText("午后闲聊").closest("[draggable]");
  const dataTransfer = { effectAllowed: "", setData: vi.fn() };

  expect(source).not.toBeNull();
  expect(target).not.toBeNull();

  fireEvent.dragStart(source as Element, { dataTransfer });
  fireEvent.dragOver(target as Element, { dataTransfer });
  fireEvent.drop(target as Element, { dataTransfer });

  expect(callbacks.onMoveRoom).toHaveBeenCalledWith("room-1", "room-2");
  expect(callbacks.onDragRoomStart).toHaveBeenCalledWith("room-1");
  expect(callbacks.onDragRoomEnd).toHaveBeenCalled();
});
