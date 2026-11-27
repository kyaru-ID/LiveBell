import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ConnectPanel } from "./ConnectPanel";

vi.mock("../../hooks/useVideoDanmaku", () => ({
  useVideoDanmaku: () => ({ close: vi.fn(), control: vi.fn(), progress: null, snapshot: null }),
}));
const search = vi.hoisted(() => ({ clear: vi.fn(), search: vi.fn() }));
vi.mock("../../hooks/useStreamerSearch", () => ({
  useStreamerSearch: () => ({ ...search, candidates: [], isSearching: false, searchError: null }),
}));

test("直播临时卡片在视频分隔区之前，重连中的临时房间也可批量断开", async () => {
  const disconnect = vi.fn();
  const user = userEvent.setup();
  render(<ConnectPanel commandErrors={{}} onAddToSaved={vi.fn()} onDisconnectAll={disconnect} onDisconnectSession={vi.fn()} temporarySessions={[{
    sessionId: "temp", requestedRoomId: 6, status: "reconnecting", message: "正在重连", anchorName: "临时主播",
  }]} />);
  const tempList = screen.getByLabelText("直播临时连接列表");
  const videoHeading = screen.getByRole("heading", { name: "视频弹幕" });
  expect(tempList.compareDocumentPosition(videoHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "BV 号或视频链接" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "断开全部临时连接" }));
  expect(disconnect).toHaveBeenCalledOnce();
});
