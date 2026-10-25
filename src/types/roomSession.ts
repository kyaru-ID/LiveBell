import type { LiveMessage } from "./danmaku";

export type RoomSessionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "not_live"
  | "invalid_room"
  | "error";

export type RoomSessionSnapshot = {
  sessionId: string;
  requestedRoomId: number;
  roomId?: number;
  anchorName?: string;
  /** 主播头像的本地缓存绝对路径（后端连上后异步补齐）。 */
  anchorAvatar?: string;
  fanMedalName?: string;
  status: RoomSessionStatus;
  message: string;
  liveStatus?: number;
};

export type DanmakuRoomBatch = {
  sessionId: string;
  roomId: number;
  anchorName?: string;
  fanMedalName?: string;
  activeSourceCount: number;
  messages: LiveMessage[];
  /** 后端标记的来源：缺省是直播间弹幕，video 表示 B 站点播视频的弹幕。 */
  sourceKind?: "video" | string;
};

export type RoomSourceOption = {
  roomId: number;
  label: string;
};

export const isNetworkSessionActive = (status: RoomSessionStatus) =>
  status === "connecting" || status === "connected" || status === "reconnecting";

export const isSourceActive = (status: RoomSessionStatus) =>
  status === "connected" || status === "reconnecting";
