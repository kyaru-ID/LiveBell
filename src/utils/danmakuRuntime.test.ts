import { expect, test } from "vitest";
import type { AppConfig } from "../types/config";
import { DEFAULT_APP_CONFIG } from "../types/config";
import type { LiveMessage } from "../types/danmaku";
import { estimateMessageWidth, isMessageTypeVisible } from "./danmakuRuntime";

function config(patch: Partial<AppConfig["messageDisplay"]> = {}): AppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    messageDisplay: { ...DEFAULT_APP_CONFIG.messageDisplay, ...patch },
  };
}

function danmaku(patch: Partial<LiveMessage> = {}): LiveMessage {
  return {
    id: "message-1",
    kind: "danmaku",
    user: "测试用户",
    text: "正文",
    ...patch,
  };
}

test("shows lottery danmaku by default", () => {
  expect(isMessageTypeVisible(danmaku({ isLottery: true }), config())).toBe(true);
});

test("hides lottery danmaku only when the lottery switch is off", () => {
  expect(
    isMessageTypeVisible(
      danmaku({ isLottery: true }),
      config({ showLottery: false }),
    ),
  ).toBe(false);
});

test("keeps plain danmaku visible when the lottery switch is off", () => {
  expect(isMessageTypeVisible(danmaku(), config({ showLottery: false }))).toBe(
    true,
  );
});

test("keeps plain danmaku hidden when the danmaku switch is off", () => {
  expect(isMessageTypeVisible(danmaku(), config({ showDanmaku: false }))).toBe(
    false,
  );
});

test("keeps default small emotes at text height regardless of emote scale", () => {
  const message = danmaku({
    segments: [
      {
        type: "emote",
        text: "[妙]",
        url: "https://i0.hdslb.com/bfs/live/miao.png",
        width: 60,
        height: 20,
      },
      { type: "text", text: "哈哈哈哈哈哈" },
    ],
  });

  const base = estimateMessageWidth(message, 20, false, true, 1);
  expect(estimateMessageWidth(message, 20, false, true, 2)).toBe(base);
});

test("scales room emote width with the emote scale", () => {
  const message = danmaku({
    segments: [
      {
        type: "emote",
        text: "无辜啾",
        url: "https://i0.hdslb.com/bfs/garb/room.png",
        width: 162,
        height: 54,
        isRoomEmote: true,
      },
    ],
  });

  const base = estimateMessageWidth(message, 20, false, true, 1);
  const scaled = estimateMessageWidth(message, 20, false, true, 2);
  expect(base).toBeGreaterThan(80);
  expect(scaled).toBeCloseTo(base * 2, 5);
});

test("does not apply the lottery switch to other message kinds", () => {
  expect(
    isMessageTypeVisible(
      danmaku({ kind: "gift", isLottery: true }),
      config({ showLottery: false, showGift: true }),
    ),
  ).toBe(true);
});
