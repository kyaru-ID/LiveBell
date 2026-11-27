import { expect, test } from "vitest";
import { DEFAULT_APP_CONFIG } from "../types/config";
import { applyLiveStatusUpdates } from "./liveStatus";

test("独立直播事件只更新匹配房间的只读字段", () => {
  const config = { ...DEFAULT_APP_CONFIG, savedRooms: [{ id: "one", roomId: "6", displayName: "主播", groupIds: ["favorite"], order: 0, isEnabled: false, liveState: "unknown" as const, updatedAt: "旧时间" }] };
  const updated = applyLiveStatusUpdates(config, [{ roomId: "6", liveState: "live", liveTitle: "标题", liveStartedAt: "开始", lastCheckedAt: "检查", lastError: null }]);
  expect(updated.savedRooms[0]).toMatchObject({ liveState: "live", liveStartedAt: "开始", isEnabled: false, groupIds: ["favorite"], updatedAt: "旧时间" });
  expect(config.savedRooms[0].liveState).toBe("unknown");
  expect(applyLiveStatusUpdates(config, [])).toBe(config);
});
