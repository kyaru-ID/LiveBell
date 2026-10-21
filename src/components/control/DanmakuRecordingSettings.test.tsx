import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import {
  EMPTY_DANMAKU_RECORDING_STATUS,
  type DanmakuRecordingStatus,
} from "../../types/recording";
import { DanmakuRecordingSettings } from "./DanmakuRecordingSettings";

function renderRecordingSettings({
  commandError = "",
  onEnabledChange = vi.fn(),
  onOpenDirectory = vi.fn(),
  onRetry = vi.fn(),
  status = EMPTY_DANMAKU_RECORDING_STATUS,
}: {
  commandError?: string;
  onEnabledChange?: (enabled: boolean) => void | Promise<void>;
  onOpenDirectory?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  status?: DanmakuRecordingStatus;
} = {}) {
  const view = render(
    <DanmakuRecordingSettings
      commandError={commandError}
      onEnabledChange={onEnabledChange}
      onOpenDirectory={onOpenDirectory}
      onRetry={onRetry}
      status={status}
    />,
  );

  return { ...view, onEnabledChange, onOpenDirectory, onRetry };
}

test("renders disabled recording controls and delegates toggle and directory actions", async () => {
  const user = userEvent.setup();
  const { onOpenDirectory, onEnabledChange } = renderRecordingSettings();

  expect(screen.getByText("关闭")).toBeVisible();
  await user.click(screen.getByRole("switch", { name: "记录弹幕" }));
  await user.click(screen.getByRole("button", { name: "打开记录目录" }));

  expect(onEnabledChange).toHaveBeenCalledWith(true);
  expect(onOpenDirectory).toHaveBeenCalledOnce();
});

test("renders waiting and zero, single, or multiple recording file details", () => {
  const { unmount } = renderRecordingSettings({
    status: {
      enabled: true,
      state: "waiting",
      activeFiles: [],
      errorMessage: null,
    },
  });
  expect(screen.getByText("等待连接")).toBeVisible();
  unmount();

  const single = renderRecordingSettings({
    status: {
      enabled: true,
      state: "recording",
      activeFiles: [{ roomId: 6, fileName: "2026-08-27-6-主播甲.txt" }],
      errorMessage: null,
    },
  });
  expect(screen.getByText("记录中")).toBeVisible();
  expect(screen.getByText("2026-08-27-6-主播甲.txt")).toBeVisible();
  single.unmount();

  renderRecordingSettings({
    status: {
      enabled: true,
      state: "recording",
      activeFiles: [
        { roomId: 6, fileName: "2026-08-27-6-主播甲.txt" },
        { roomId: 7, fileName: "2026-08-27-7-主播乙.txt" },
      ],
      errorMessage: null,
    },
  });
  expect(screen.getByText("记录中 · 2 个房间")).toBeVisible();
  expect(screen.getByText("2026-08-27-6-主播甲.txt")).toBeVisible();
  expect(screen.getByText("2026-08-27-7-主播乙.txt")).toBeVisible();
});

test("renders paused recording recovery without implying backfill", async () => {
  const user = userEvent.setup();
  const { onRetry } = renderRecordingSettings({
    status: {
      enabled: true,
      state: "error",
      activeFiles: [],
      errorMessage: "记录目录无访问权限，记录已暂停",
    },
  });

  expect(screen.getAllByText("记录已暂停")).toHaveLength(2);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "暂停期间的消息不会补写",
  );
  await user.click(screen.getByRole("button", { name: "重试记录" }));
  expect(onRetry).toHaveBeenCalledOnce();
});
