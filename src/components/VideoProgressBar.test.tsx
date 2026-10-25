import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { VideoDanmakuSnapshot } from "../types/videoDanmaku";
import { VideoProgressBar } from "./VideoProgressBar";
import { parseTimeInput } from "./videoTimeInput";

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

test("parseTimeInput reads colon formats and bare seconds", () => {
  expect(parseTimeInput("1:35")).toBe(95_000);
  expect(parseTimeInput("0:05")).toBe(5_000);
  expect(parseTimeInput("1:02:03")).toBe(3_723_000);
  expect(parseTimeInput("95")).toBe(95_000);
  expect(parseTimeInput(" 2:00 ")).toBe(120_000);
  expect(parseTimeInput("1:99")).toBeNull();
  expect(parseTimeInput("abc")).toBeNull();
  expect(parseTimeInput("")).toBeNull();
});

test("clicking the time opens an editable input seeded with the current position", async () => {
  const user = userEvent.setup();
  render(
    <VideoProgressBar
      onClose={vi.fn()}
      onControl={vi.fn()}
      progress={null}
      snapshot={makeSnapshot({ positionMs: 65_000 })}
    />,
  );

  await user.click(screen.getByRole("button", { name: "修改播放时间" }));

  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  expect(input).toHaveValue("1:05");
});

test("enter seeks immediately with the typed time", async () => {
  const user = userEvent.setup();
  const onControl = vi.fn();
  render(
    <VideoProgressBar
      onClose={vi.fn()}
      onControl={onControl}
      progress={null}
      snapshot={makeSnapshot()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "1:35{Enter}");

  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 95_000 });
  expect(screen.queryByRole("textbox", { name: "跳转到时间" })).not.toBeInTheDocument();
});

test("bare seconds input is treated as seconds", async () => {
  const user = userEvent.setup();
  const onControl = vi.fn();
  render(
    <VideoProgressBar
      onClose={vi.fn()}
      onControl={onControl}
      progress={null}
      snapshot={makeSnapshot()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "95{Enter}");

  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 95_000 });
});

test("time past the end clamps to the last frame", async () => {
  const user = userEvent.setup();
  const onControl = vi.fn();
  render(
    <VideoProgressBar
      onClose={vi.fn()}
      onControl={onControl}
      progress={null}
      snapshot={makeSnapshot({ durationMs: 60_000 })}
    />,
  );

  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "99:59{Enter}");

  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 60_000 });
});

test("unparsable input keeps the old position and does not seek", async () => {
  const user = userEvent.setup();
  const onControl = vi.fn();
  render(
    <VideoProgressBar
      onClose={vi.fn()}
      onControl={onControl}
      progress={null}
      snapshot={makeSnapshot({ positionMs: 65_000 })}
    />,
  );

  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "abc{Enter}");

  expect(onControl).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "修改播放时间" })).toHaveTextContent("1:05");
});

test("escape cancels without seeking", async () => {
  const user = userEvent.setup();
  const onControl = vi.fn();
  render(
    <VideoProgressBar
      onClose={vi.fn()}
      onControl={onControl}
      progress={null}
      snapshot={makeSnapshot()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "2:00{Escape}");

  expect(onControl).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: "跳转到时间" })).not.toBeInTheDocument();
});

test("blurring the input commits the typed time", async () => {
  const user = userEvent.setup();
  const onControl = vi.fn();
  render(
    <VideoProgressBar
      onClose={vi.fn()}
      onControl={onControl}
      progress={null}
      snapshot={makeSnapshot()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "修改播放时间" }));
  const input = screen.getByRole("textbox", { name: "跳转到时间" });
  await user.clear(input);
  await user.type(input, "3:00");
  await user.tab();

  expect(onControl).toHaveBeenCalledWith({ action: "seek", positionMs: 180_000 });
});
