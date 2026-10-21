interface AppLogoProps {
  /** 正方形边长（px）。 */
  size?: number;
  /** 装饰性用途：不向读屏播报名称。 */
  decorative?: boolean;
  className?: string;
}

/**
 * 图形层样式。
 *
 * 颜色必须走内联 style：写成 Tailwind 的 `bg-[var(--drift-ui-signal-text)]` 且紧跟
 * 模板字符串插值时，Tailwind v4 的候选提取器会把整条候选丢掉，图形会完全透明
 * （v2.0.9 测试版在真实环境里踩过：方块底有颜色、铃形一点没有）。
 */
const GLYPH_STYLE = {
  maskImage: "url(/icon-mask.svg)",
  maskMode: "alpha",
  maskSize: "contain",
  maskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskImage: "url(/icon-mask.svg)",
  WebkitMaskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  backgroundColor: "var(--drift-ui-signal-text)",
} as const;

/**
 * 应用图标：只有一张铃形 SVG 蒙版，**透明底**，不含方块底色。
 *
 * 颜色取自主题变量 `--drift-ui-signal-text`（深色主题浅青、浅色主题深青），
 * 所以切主题时图形颜色会自动跟着变，也不会在两种底色上糊成一块。
 */
export function AppLogo({ size = 36, decorative = false, className = "" }: AppLogoProps) {
  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "LiveBell"}
      className={`drift-theme-transition inline-block shrink-0 ${className}`.trim()}
      role={decorative ? undefined : "img"}
      style={{ width: size, height: size }}
    >
      <span aria-hidden="true" className="block h-full w-full" style={GLYPH_STYLE} />
    </span>
  );
}
