import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { NotificationRecord } from "../../types/notification";
import { NotificationHistorySettings } from "./NotificationHistorySettings";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

const RECORDS: NotificationRecord[] = [
  {
    id: "n1",
    time: "2026-10-17T12:00:00.000Z",
    streamerName: "主播甲",
    title: "今晚八点开播",
    roomId: "123456",
    isRead: false,
  },
  {
    id: "n2",
    time: "2026-10-17T11:00:00.000Z",
    streamerName: "主播乙",
    title: "",
    roomId: "654321",
    isRead: true,
  },
];

afterEach(() => {
  clearMocks();
  vi.clearAllMocks();
});

test("shows the clear confirmation above the list, not after it", async () => {
  const calls: string[] = [];
  mockIPC((command) => {
    calls.push(command);
    if (command === "notifications_list") {
      return RECORDS;
    }
    return null;
  });
  const user = userEvent.setup();
  render(<NotificationHistorySettings />);

  // 记录加载完成后「清空」才可用；此时确认条还不该出现。
  const clearButton = await screen.findByRole("button", { name: "清空" });
  expect(screen.queryByText("确认清空全部开播提醒记录？")).toBeNull();

  await user.click(clearButton);

  const banner = screen.getByRole("alert");
  expect(banner).toHaveTextContent("确认清空全部开播提醒记录？");
  // 列表很长时确认条原本在列表下方，滚到底才看得见；这里锁死它必须排在列表前面。
  const section = screen.getByRole("region", { name: "开播提醒记录" });
  expect(
    banner.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "确认清空" }));
  expect(calls).toContain("notifications_clear");
  expect(screen.queryByText("确认清空全部开播提醒记录？")).toBeNull();
});

test("cancel closes the confirmation without clearing records", async () => {
  const calls: string[] = [];
  mockIPC((command) => {
    calls.push(command);
    if (command === "notifications_list") {
      return RECORDS;
    }
    return null;
  });
  const user = userEvent.setup();
  render(<NotificationHistorySettings />);

  await user.click(await screen.findByRole("button", { name: "清空" }));
  await user.click(screen.getByRole("button", { name: "取消" }));

  expect(screen.queryByText("确认清空全部开播提醒记录？")).toBeNull();
  expect(calls).not.toContain("notifications_clear");
});
