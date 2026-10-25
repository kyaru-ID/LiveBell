import type { DanmakuItem } from "../types/danmaku";
import { DanmakuTrack } from "./DanmakuTrack";

type DanmakuOverlayProps = {
  items: DanmakuItem[];
  onItemDone?: (itemId: string) => void;
  showEmotes: boolean;
  trackCount: number;
  showUsername: boolean;
  /** 视频暂停时冻结所有滚动动画。 */
  paused?: boolean;
};

export function DanmakuOverlay({
  items,
  onItemDone,
  showEmotes,
  showUsername,
  trackCount,
  paused = false,
}: DanmakuOverlayProps) {
  return (
    <section
      className="danmaku-layer pointer-events-none absolute inset-0"
      data-paused={paused ? "true" : "false"}
      aria-label="LiveBell弹幕预览"
    >
      {items.map((item) => (
        <DanmakuTrack
          item={item}
          key={item.id}
          onDone={onItemDone}
          showEmotes={showEmotes}
          showUsername={showUsername}
          trackCount={trackCount}
        />
      ))}
    </section>
  );
}
