import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { VideoDanmakuSnapshot } from "../../types/videoDanmaku";
import { HomeVideoControl } from "./HomeVideoControl";

function makeSnapshot(overrides: Partial<VideoDanmakuSnapshot> = {}) {
  return {
    sessionId: "video:1",
    aid: 1,
    bvid: "BV1xx",
    title: "测试视频",
    cid: 1,
    pageIndex: 0,
    pageTitle: "",
    durationMs: 600_000,
    positionMs: 0,
    playing: false,
    rate: 1,
    looping: false,
    finished: false,
    loading: false,
    pages: [],
    ...overrides,
  } satisfies VideoDanmakuSnapshot;
}

function renderBar(
  snapshot: Partial<VideoDanmakuSnapshot> = {},
  onControl = vi.fn(),
  onClose = vi.fn(),
) {
  render(
    <HomeVideoControl
      onClose={onClose}
      onControl={onControl}
      progress={null}
      snapshot={makeSnapshot(snapshot)}
    />,
  );
  return { onClose, onControl };
}

test("shows the video title and page name", () => {
  renderBar({ pageTitle: "第二话", title: "测试视频" });
  expect(screen.getByText("测试视频")).toBeInTheDocument();
  expect(screen.getByText(/第二话/)).toBeInTheDocument();
});

test("play button sends play when paused", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar({ playing: false });
  await user.click(screen.getByRole("button", { name: "播放" }));
  expect(onControl).toHaveBeenCalledWith({ action: "play" });
});

test("pause button sends pause when playing", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar({ playing: true });
  await user.click(screen.getByRole("button", { name: "暂停" }));
  expect(onControl).toHaveBeenCalledWith({ action: "pause" });
});

test("dragging the range seeks to the dropped position", () => {
  const { onControl } = renderBar();
  const range = screen.getByRole("slider", { name: "视频进度" });
  fireEvent.pointerDown(range);
  fireEvent.change(range, { target: { value: "120000" } });
  fireEvent.pointerUp(range);
  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 120_000 });
});

test("changing the rate sends setRate", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar({ rate: 1 });
  await user.selectOptions(screen.getByLabelText("播放倍速"), "1.5");
  expect(onControl).toHaveBeenCalledWith({ action: "setRate", rate: 1.5 });
});

test("looping toggle flips setLooping", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar({ looping: false });
  await user.click(screen.getByRole("button", { name: "循环播放" }));
  expect(onControl).toHaveBeenCalledWith({ action: "setLooping", looping: true });
});

test("page select is hidden for single part videos and shown for multi part", async () => {
  renderBar({ pages: [] });
  expect(screen.queryByLabelText("分P")).not.toBeInTheDocument();
});

test("selecting another part sends selectPage", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar({
    pageIndex: 0,
    pages: [
      { index: 0, page: 1, part: "第一话", durationMs: 600_000, active: true },
      { index: 1, page: 2, part: "第二话", durationMs: 600_000, active: false },
    ],
  });
  await user.selectOptions(screen.getByLabelText("分P"), "1");
  expect(onControl).toHaveBeenCalledWith({ action: "selectPage", index: 1 });
});

test("disconnect button calls onClose", async () => {
  const user = userEvent.setup();
  const { onClose } = renderBar();
  await user.click(screen.getByRole("button", { name: "断开视频弹幕" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("loading and error text are shown without breaking the bar", () => {
  renderBar({ loading: true, error: "分段加载失败" });
  expect(screen.getByText("加载中…")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("分段加载失败");
});

test("clicking the time opens an editable input seeded with the current position", async () => {
  const user = userEvent.setup();
  renderBar({ positionMs: 65_000 });
  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  expect(screen.getByRole("textbox", { name: "跳转到时间" })).toHaveValue("1:05");
});

test("enter seeks immediately with the typed time", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar();
  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "1:35{Enter}");
  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 95_000 });
  expect(screen.queryByRole("textbox", { name: "跳转到时间" })).not.toBeInTheDocument();
});

test("bare seconds input is treated as seconds", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar();
  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "95{Enter}");
  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 95_000 });
});

test("time past the end clamps to the last frame", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar({ durationMs: 60_000 });
  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "99:59{Enter}");
  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 60_000 });
});

test("unparsable input keeps the old position and does not seek", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar({ positionMs: 65_000 });
  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "abc{Enter}");
  expect(onControl).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "修改播放时间" })).toHaveTextContent("1:05");
});

test("escape cancels the time edit without seeking", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar();
  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "2:00{Escape}");
  expect(onControl).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "跳转到时间" })).not.toBeInTheDocument();
});

test("blurring the input commits the typed time", async () => {
  const user = userEvent.setup();
  const { onControl } = renderBar();
  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "3:00");
  await user.tab();
  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 180_000 });
});
