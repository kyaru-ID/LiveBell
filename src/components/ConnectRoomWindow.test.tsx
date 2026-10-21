import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ConnectRoomWindow } from "./ConnectRoomWindow";

const eventMock = vi.hoisted(() => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();

  return {
    emit(event: string, payload: unknown) {
      handlers.get(event)?.({ payload });
    },
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

function payloadRecord(
  payload: InvokeArgs | undefined,
): Record<string, unknown> {
  return payload && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function roomInput() {
  return screen.getByRole("textbox", { name: "房间号、直播间链接或主播名" });
}

test("queries the room status after the debounce and connects the typed room", async () => {
  const calls: Array<{ command: string; payload: Record<string, unknown> }> =
    [];
  mockIPC((command, payload) => {
    calls.push({ command, payload: payloadRecord(payload) });
    if (command === "live_check_room") {
      return { isLive: true, roomId: "24160384", title: "亚服排位" };
    }
    return null;
  });
  const user = userEvent.setup();
  render(<ConnectRoomWindow />);

  expect(screen.getByRole("button", { name: "连接" })).toBeDisabled();

  fireEvent.change(roomInput(), {
    target: { value: "https://live.bilibili.com/24160384" },
  });

  expect(
    await screen.findByText("房间 24160384 · 直播中 · 亚服排位"),
  ).toBeVisible();
  expect(calls).toContainEqual({
    command: "live_check_room",
    payload: { roomId: "24160384" },
  });

  await user.click(screen.getByRole("button", { name: "连接" }));

  await waitFor(() =>
    expect(calls).toContainEqual({
      command: "connect_bilibili_room",
      payload: { requestedRoomId: 24160384 },
    }),
  );
  expect(calls).toContainEqual({
    command: "show_window",
    payload: { label: "main" },
  });
  expect(calls).toContainEqual({
    command: "hide_connect_room_window",
    payload: {},
  });
});

test("falls back to a connectable hint when the status query fails", async () => {
  mockIPC((command) => {
    if (command === "live_check_room") {
      throw new Error("开播状态请求失败：网络错误");
    }
    return null;
  });
  render(<ConnectRoomWindow />);

  fireEvent.change(roomInput(), { target: { value: "7654321" } });

  expect(
    await screen.findByText("房间 7654321（状态查询失败，仍可尝试连接）"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "连接" })).toBeEnabled();
});

test("keeps invalid input out of the network path and closes on Escape", async () => {
  const calls: Array<{ command: string; payload: Record<string, unknown> }> =
    [];
  mockIPC((command, payload) => {
    calls.push({ command, payload: payloadRecord(payload) });
    return null;
  });
  render(<ConnectRoomWindow />);

  fireEvent.change(roomInput(), { target: { value: "不是房间号" } });
  await new Promise((resolve) => setTimeout(resolve, 600));

  expect(calls.filter((call) => call.command === "live_check_room")).toEqual([]);
  expect(screen.getByRole("button", { name: "连接" })).toBeDisabled();

  fireEvent.keyDown(window, { key: "Escape" });

  await waitFor(() =>
    expect(calls).toContainEqual({
      command: "hide_connect_room_window",
      payload: {},
    }),
  );
});

test("resets the input when the connect window is opened again", async () => {
  mockIPC((command) => {
    if (command === "live_check_room") {
      return { isLive: false, roomId: "7654321", title: "" };
    }
    return null;
  });
  render(<ConnectRoomWindow />);

  fireEvent.change(roomInput(), { target: { value: "7654321" } });
  expect(
    await screen.findByText("房间 7654321 · 未开播"),
  ).toBeVisible();

  eventMock.emit("connect-window-opened", null);

  await waitFor(() => expect(roomInput()).toHaveValue(""));
});
