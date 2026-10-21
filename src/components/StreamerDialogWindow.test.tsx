import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  DEFAULT_APP_CONFIG,
  type AppConfig,
  type SavedRoom,
} from "../types/config";
import type { StreamerCandidate } from "../types/streamer";
import { StreamerDialogWindow } from "./StreamerDialogWindow";

const eventMock = vi.hoisted(() => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();

  return {
    handlers,
    listen: vi.fn(
      async (
        event: string,
        callback: (event: { payload: unknown }) => void,
      ) => {
        handlers.set(event, callback);
        return vi.fn(() => {
          if (handlers.get(event) === callback) {
            handlers.delete(event);
          }
        });
      },
    ),
    reset() {
      handlers.clear();
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMock.listen,
}));

afterEach(() => {
  clearMocks();
  vi.clearAllMocks();
  eventMock.reset();
});

const SAVED_ROOM: SavedRoom = {
  id: "room-1",
  roomId: "21852",
  displayName: "老番茄",
  anchorName: "老番茄",
  groupIds: ["game"],
  order: 0,
  isEnabled: true,
  liveState: "unknown",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

const CONFIG: AppConfig = {
  ...DEFAULT_APP_CONFIG,
  savedRoomGroups: [
    {
      id: "game",
      name: "游戏",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
  ],
  savedRooms: [SAVED_ROOM],
};

const CANDIDATE: StreamerCandidate = {
  avatarUrl: "https://i0.hdslb.com/bfs/face/x.jpg",
  name: "老番茄",
  roomId: 21852,
  uid: 546195,
};

type Call = { command: string; args: InvokeArgs | undefined };

function installIPC(options: {
  candidates?: StreamerCandidate[];
  target?: string | null;
} = {}) {
  const calls: Call[] = [];
  mockIPC(async (command, payload) => {
    calls.push({ command, args: payload });
    switch (command) {
      case "load_app_config":
        return CONFIG;
      case "streamer_dialog_target":
        return options.target ?? null;
      case "streamer_search":
        return options.candidates ?? [];
      case "save_app_config":
        return (payload as { config: AppConfig }).config;
      case "sync_room_avatars":
        return 0;
      default:
        return undefined;
    }
  });
  return calls;
}

function savedConfig(calls: Call[]) {
  const call = calls.find((item) => item.command === "save_app_config");
  return (call?.args as { config: AppConfig } | undefined)?.config;
}

function setInput(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  return input;
}

test("没有待编辑目标时是「添加主播」且输入为空", async () => {
  installIPC();
  render(<StreamerDialogWindow />);

  expect(await screen.findByText("添加主播")).toBeTruthy();
  expect((screen.getByLabelText("主播名称") as HTMLInputElement).value).toBe("");
  expect(
    (screen.getByLabelText("房间号或直播间链接") as HTMLInputElement).value,
  ).toBe("");
  expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
});

test("待编辑目标存在时预填名字、房间号与分组", async () => {
  installIPC({ target: "room-1" });
  render(<StreamerDialogWindow />);

  expect(await screen.findByText("编辑主播")).toBeTruthy();
  expect((screen.getByLabelText("主播名称") as HTMLInputElement).value).toBe(
    "老番茄",
  );
  expect(
    (screen.getByLabelText("房间号或直播间链接") as HTMLInputElement).value,
  ).toBe("21852");
  expect(screen.getByRole("button", { name: "选择分组 游戏" }).getAttribute(
    "aria-pressed",
  )).toBe("true");
  expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
});

test("缺名字时保存被拦下并给出老版文案", async () => {
  const calls = installIPC();
  render(<StreamerDialogWindow />);
  await screen.findByText("添加主播");

  setInput("房间号或直播间链接", "123456");
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByText("请输入主播名称。")).toBeTruthy();
  expect(savedConfig(calls)).toBeUndefined();
});

test("缺房间号时保存被拦下并给出老版文案", async () => {
  const calls = installIPC();
  render(<StreamerDialogWindow />);
  await screen.findByText("添加主播");

  setInput("主播名称", "深夜电台");
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  expect(
    await screen.findByText("请输入有效房间号或 live.bilibili.com 链接。"),
  ).toBeTruthy();
  expect(savedConfig(calls)).toBeUndefined();
});

test("填好名字与直播间链接后保存写进关注列表", async () => {
  const calls = installIPC();
  render(<StreamerDialogWindow />);
  await screen.findByText("添加主播");

  setInput("主播名称", "深夜电台");
  setInput("房间号或直播间链接", "https://live.bilibili.com/123456");
  fireEvent.click(screen.getByRole("button", { name: "选择分组 游戏" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() => {
    expect(savedConfig(calls)).toBeTruthy();
  });
  const config = savedConfig(calls) as AppConfig;
  expect(config.savedRooms).toHaveLength(2);
  // 新主播排在列表最前（order 最小），所以按 roomId 找而不是按下标。
  expect(
    config.savedRooms.find((room) => room.roomId === "123456"),
  ).toMatchObject({
    roomId: "123456",
    displayName: "深夜电台",
    groupIds: ["game"],
  });
});

test("搜到候选后点一下会把名字和房间号填上", async () => {
  installIPC({ candidates: [CANDIDATE] });
  render(<StreamerDialogWindow />);
  await screen.findByText("添加主播");

  setInput("主播名称", "老番茄");

  const candidate = await screen.findByRole(
    "button",
    { name: "选择主播 老番茄" },
    { timeout: 3000 },
  );
  expect(screen.getByText("UID 546195")).toBeTruthy();
  fireEvent.click(candidate);

  expect((screen.getByLabelText("主播名称") as HTMLInputElement).value).toBe(
    "老番茄",
  );
  expect(
    (screen.getByLabelText("房间号或直播间链接") as HTMLInputElement).value,
  ).toBe("21852");
});
