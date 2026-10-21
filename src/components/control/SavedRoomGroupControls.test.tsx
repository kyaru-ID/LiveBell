import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { SavedRoomGroup } from "../../types/config";
import { SavedRoomGroupControls } from "./SavedRoomGroupControls";

const GROUPS: SavedRoomGroup[] = [
  {
    id: "chat",
    name: "聊天",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  },
  {
    id: "game",
    name: "游戏",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
  },
];

function renderGroupControls(
  draggedRoomId: string | null = null,
  options: { createActionPosition?: "actions" | "tabs-end" } = {},
) {
  const callbacks = {
    onCreateGroup: vi.fn(async () => true),
    onDeleteGroup: vi.fn(async () => true),
    onDropRoomToGroup: vi.fn(),
    onRenameGroup: vi.fn(async () => true),
    onSearchQueryChange: vi.fn(),
    onSelectedGroupChange: vi.fn(),
  };

  render(
    <SavedRoomGroupControls
      draggedRoomId={draggedRoomId}
      groups={GROUPS}
      searchQuery=""
      selectedGroupId="chat"
      {...options}
      {...callbacks}
    />,
  );

  return callbacks;
}

test("uses the grouped room toolbar and keeps search and selection", async () => {
  const user = userEvent.setup();
  const callbacks = renderGroupControls();

  expect(
    screen.getByRole("toolbar", { name: "常用直播间工具栏" }),
  ).toBeVisible();
  await user.type(screen.getByRole("searchbox", { name: "搜索常用直播间" }), "深夜");
  await user.click(screen.getByRole("tab", { name: "游戏" }));

  expect(callbacks.onSearchQueryChange).toHaveBeenLastCalledWith("夜");
  expect(callbacks.onSelectedGroupChange).toHaveBeenCalledWith("game");
});

test("closes create and rename editors after successful promises", async () => {
  const user = userEvent.setup();
  const callbacks = renderGroupControls();

  // 页签尾部留白的虚线「＋」是同一个名字（Role-only 查询默认不算 aria-hidden 子树），
  // 这里点的是右侧操作区那个正式的「新建分组」按钮。
  const createButtons = screen.getAllByRole("button", { name: "新建分组" });
  await user.click(createButtons[createButtons.length - 1]);
  expect(
    screen.getByRole("textbox", { name: "新分组名称" }).closest(".rounded-lg"),
  ).toHaveClass(
    "drift-theme-transition",
    "bg-[var(--drift-ui-surface)]",
  );
  await user.type(screen.getByRole("textbox", { name: "新分组名称" }), "赛事");
  await user.click(screen.getByRole("button", { name: "添加" }));
  expect(callbacks.onCreateGroup).toHaveBeenCalledWith("赛事");
  await waitFor(() => {
    expect(screen.queryByRole("textbox", { name: "新分组名称" })).not.toBeInTheDocument();
  });

  await user.click(screen.getByRole("button", { name: "重命名分组" }));
  const renameInput = screen.getByRole("textbox", { name: "重命名分组" });
  await user.clear(renameInput);
  await user.type(renameInput, "闲聊");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(callbacks.onRenameGroup).toHaveBeenCalledWith("chat", "闲聊");
  await waitFor(() => {
    expect(screen.queryByRole("textbox", { name: "重命名分组" })).not.toBeInTheDocument();
  });
});

test("keeps delete confirmation and cancellation", async () => {
  const user = userEvent.setup();
  const callbacks = renderGroupControls();

  await user.click(screen.getByRole("button", { name: "删除分组" }));
  expect(screen.getByRole("dialog", { name: "删除分组" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog", { name: "删除分组" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "删除分组" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  expect(callbacks.onDeleteGroup).toHaveBeenCalledWith("chat");
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "删除分组" })).not.toBeInTheDocument();
  });
});

test("selects the ungrouped tab and accepts drops on group tabs", async () => {
  const user = userEvent.setup();
  const callbacks = renderGroupControls("room-1");

  await user.click(screen.getByRole("tab", { name: "未分组" }));
  expect(callbacks.onSelectedGroupChange).toHaveBeenCalledWith("uncategorized");

  fireEvent.drop(screen.getByRole("tab", { name: "未分组" }));
  expect(callbacks.onDropRoomToGroup).toHaveBeenCalledWith(
    "room-1",
    "uncategorized",
  );

  fireEvent.drop(screen.getByRole("tab", { name: "游戏" }));
  expect(callbacks.onDropRoomToGroup).toHaveBeenCalledWith("room-1", "game");
});

test("creates a group from the strip-end button through the inline panel", async () => {
  const user = userEvent.setup();
  const callbacks = renderGroupControls(null, { createActionPosition: "tabs-end" });
  // 页签尾部的「新建分组」和普通分组页签一样是 role=tab，紧跟在最后一个分组之后。
  const createButton = screen.getByRole("tab", { name: "新建分组" });

  // 主界面只在页签尾部留一个新建入口（右端操作区不再重复一个）。
  expect(
    screen.getAllByRole("tab", { name: "新建分组" }),
  ).toHaveLength(1);
  // 它必须紧挨最后一个分组页签，而不是跑到右端「全部断开」那侧。
  const tabs = screen.getAllByRole("tab");
  expect(tabs[tabs.length - 1]).toBe(createButton);
  // 点之前没有输入框，点之后分组条下方弹出输入栏（和「重命名分组」同一个面板）。
  expect(
    screen.queryByRole("textbox", { name: "新分组名称" }),
  ).not.toBeInTheDocument();

  await user.click(createButton);
  const input = screen.getByRole("textbox", { name: "新分组名称" });
  expect(input).toHaveFocus();

  await user.type(input, "赛事{Enter}");

  expect(callbacks.onCreateGroup).toHaveBeenCalledWith("赛事");
  await waitFor(() => {
    expect(
      screen.queryByRole("textbox", { name: "新分组名称" }),
    ).not.toBeInTheDocument();
  });
});

test("collapses the inline group editor on Escape without creating", async () => {
  const user = userEvent.setup();
  const callbacks = renderGroupControls(null, { createActionPosition: "tabs-end" });

  await user.click(screen.getByRole("tab", { name: "新建分组" }));
  await user.type(
    screen.getByRole("textbox", { name: "新分组名称" }),
    "临时{Escape}",
  );

  expect(callbacks.onCreateGroup).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: "新分组名称" }),
  ).not.toBeInTheDocument();
});

test("ignores group tab drops without a dragged room", () => {
  const callbacks = renderGroupControls();

  fireEvent.drop(screen.getByRole("tab", { name: "游戏" }));

  expect(callbacks.onDropRoomToGroup).not.toHaveBeenCalled();
});
