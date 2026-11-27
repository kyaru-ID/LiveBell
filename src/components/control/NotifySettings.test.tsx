import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { DEFAULT_APP_CONFIG } from "../../types/config";
import { NotifySettings } from "./NotifySettings";

test("保存完成前显示忙碌状态，成功后才显示已保存", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const save = vi.fn(() => pending);
  const user = userEvent.setup();
  render(<NotifySettings config={DEFAULT_APP_CONFIG} onUpdateNotification={save} />);
  fireEvent.change(screen.getByLabelText("检测间隔"), { target: { value: "12" } });
  await user.click(screen.getByRole("button", { name: "保存检测间隔" }));
  expect(save).toHaveBeenCalledWith({ monitorIntervalSeconds: 12 });
  expect(screen.getByRole("status")).toHaveTextContent("正在保存");
  expect(screen.queryByText(/开播检测间隔已保存/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存停留时长" })).toBeDisabled();
  await act(async () => { finish(); await pending; });
  expect(screen.getByRole("status")).toHaveTextContent("开播检测间隔已保存：12 秒");
});

test("保存失败保留输入，允许重试且不显示成功提示", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("磁盘不可写")).mockResolvedValueOnce(undefined);
  const user = userEvent.setup();
  render(<NotifySettings config={DEFAULT_APP_CONFIG} onUpdateNotification={save} />);
  fireEvent.change(screen.getByLabelText("停留时长"), { target: { value: "18" } });
  await user.click(screen.getByRole("button", { name: "保存停留时长" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("磁盘不可写");
  expect(screen.getByLabelText("停留时长")).toHaveValue(18);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "保存停留时长" }));
  expect(await screen.findByRole("status")).toHaveTextContent("提醒停留时长已保存：18 秒");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("开关保存失败仍显示原状态并报告错误", async () => {
  const save = vi.fn(async () => { throw new Error("保存被拒绝"); });
  const user = userEvent.setup();
  render(<NotifySettings config={DEFAULT_APP_CONFIG} onUpdateNotification={save} />);
  const toggle = screen.getByRole("switch", { name: "提醒声音" });
  await user.click(toggle);
  expect(save).toHaveBeenCalledWith({ soundEnabled: !DEFAULT_APP_CONFIG.notification.soundEnabled });
  expect(await screen.findByRole("alert")).toHaveTextContent("保存被拒绝");
  expect(toggle).toHaveAttribute("aria-checked", String(DEFAULT_APP_CONFIG.notification.soundEnabled));
  expect(toggle).toBeEnabled();
});
