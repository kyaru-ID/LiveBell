import { expect, test, vi } from "vitest";
import { avatarSrc } from "./avatar";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => {
    if (path === "boom") {
      throw new Error("not in tauri");
    }
    return `asset://localhost/${path}`;
  },
}));

test("本地头像路径转成 webview 能加载的地址", () => {
  expect(avatarSrc("E:\\Data\\Avatars\\a.jpg")).toBe(
    "asset://localhost/E:\\Data\\Avatars\\a.jpg",
  );
});

test("没有路径时返回 undefined，交给调用方显示首字", () => {
  expect(avatarSrc()).toBeUndefined();
  expect(avatarSrc(null)).toBeUndefined();
  expect(avatarSrc("   ")).toBeUndefined();
});

test("转换失败时不抛异常", () => {
  expect(avatarSrc("boom")).toBeUndefined();
});
