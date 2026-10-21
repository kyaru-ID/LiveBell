import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import sidebarSource from "./SettingsSidebar.tsx?raw";
import { SettingsSidebar } from "./SettingsSidebar";

test("keeps existing tab ids while switching sidebar pages", async () => {
  const user = userEvent.setup();
  const onTabChange = vi.fn();

  render(
    <SettingsSidebar
      activeTab="account"
      collapsed={false}
      onCollapsedChange={vi.fn()}
      onTabChange={onTabChange}
    />,
  );

  expect(screen.getByRole("button", { name: "账号" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await user.click(screen.getByRole("button", { name: "弹幕显示" }));
  expect(onTabChange).toHaveBeenCalledWith("display");
});

test("exposes the manual collapse action", async () => {
  const user = userEvent.setup();
  const onCollapsedChange = vi.fn();

  render(
    <SettingsSidebar
      activeTab="room"
      collapsed={false}
      onCollapsedChange={onCollapsedChange}
      onTabChange={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "收起侧边栏" }));
  expect(onCollapsedChange).toHaveBeenCalledWith(true);
});

test("does not repeat the app name at the top of the sidebar", () => {
  render(
    <SettingsSidebar
      activeTab="account"
      collapsed={false}
      onCollapsedChange={vi.fn()}
      onTabChange={vi.fn()}
    />,
  );

  // 窗口标题栏已经写了「LiveBell 设置」，侧栏不再重复品牌块。
  expect(screen.queryByText("LiveBell")).toBeNull();
  expect(screen.queryByText("诶")).toBeNull();
});

test("uses border-box sizing for the target sidebar width", () => {
  render(
    <SettingsSidebar
      activeTab="account"
      collapsed={false}
      onCollapsedChange={vi.fn()}
      onTabChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("complementary")).toHaveClass(
    "box-border",
    "drift-settings-sidebar",
    "bg-[var(--drift-ui-sidebar)]",
  );
  expect(screen.getByRole("button", { name: "账号" })).toHaveClass(
    "bg-[var(--drift-ui-selected)]",
  );
  expect(
    screen.getByRole("button", { name: "账号" }).querySelector("span"),
  ).toHaveClass(
    "shadow-[0_0_9px_color-mix(in_srgb,var(--drift-ui-signal)_55%,transparent)]",
  );
  expect(sidebarSource).not.toMatch(
    /rgba?\(\s*50(?:\s*,\s*|\s+)199(?:\s*,\s*|\s+)217/i,
  );
});
