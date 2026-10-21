import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppLogo } from "./AppLogo";

describe("AppLogo", () => {
  it("renders as a labelled image by default", () => {
    render(<AppLogo size={36} />);
    const logo = screen.getByRole("img", { name: "LiveBell" });
    expect(logo).toHaveStyle({ width: "36px", height: "36px" });
    // 图形靠 SVG 蒙版着色，主题切换时颜色跟着 CSS 变量走。
    expect(logo.firstElementChild).toHaveStyle({ maskImage: "url(/icon-mask.svg)" });
    // 颜色必须落在内联 style 上：写成 Tailwind 的 `bg-[var(--...)]` 且紧跟模板字符串插值时，
    // Tailwind v4 会丢弃该候选，图形会完全透明（v2.0.9 测试版真实踩过）。
    expect(logo.firstElementChild).toHaveStyle({
      backgroundColor: "var(--drift-ui-signal-text)",
    });
  });

  it("hides itself from assistive tech when decorative", () => {
    render(<AppLogo decorative size={52} />);
    expect(screen.queryByRole("img", { name: "LiveBell" })).toBeNull();
    expect(document.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("draws the glyph without any block background", () => {
    render(<AppLogo size={36} />);
    const logo = screen.getByRole("img", { name: "LiveBell" });
    // 透明底：外层不再有 --drift-ui-selected 的方块底色。
    expect(logo.getAttribute("style") ?? "").not.toContain("background");
  });
});
