import type { AppConfig, LiveState } from "../types/config";

export type LiveStatusUpdate = {
  roomId: string;
  liveState: LiveState;
  liveTitle: string | null;
  liveStartedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

/** 开播状态是内存数据，通过独立事件更新，不触发整份设置的持久化。 */
export function applyLiveStatusUpdates(
  config: AppConfig,
  updates: LiveStatusUpdate[],
): AppConfig {
  const byRoom = new Map(updates.map((update) => [update.roomId, update]));
  let changed = false;
  const savedRooms = config.savedRooms.map((room) => {
    const update = byRoom.get(room.roomId);
    if (!update) return room;
    changed = true;
    return {
      ...room,
      liveState: update.liveState,
      liveTitle: update.liveTitle ?? undefined,
      liveStartedAt: update.liveStartedAt ?? undefined,
      lastCheckedAt: update.lastCheckedAt ?? undefined,
      lastError: update.lastError ?? undefined,
    };
  });
  return changed ? { ...config, savedRooms } : config;
}
