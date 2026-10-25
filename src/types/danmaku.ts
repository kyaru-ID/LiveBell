import type { RoomSessionStatus } from "./roomSession";

export type LiveMessageKind = "danmaku" | "gift" | "guard" | "super_chat";

export type LiveMessageSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "emote";
      text: string;
      url?: string;
      width?: number;
      height?: number;
      /** 直播间 / 收藏集大表情（跟随「表情大小」滑块）；默认小表情（黄豆）没有这个标记。 */
      isRoomEmote?: boolean;
    };

export type DisplayMessageItem = {
  id: string;
  kind: LiveMessageKind;
  sourceLabel?: string;
  sourceColorIndex?: number;
  user?: string;
  text: string;
  segments?: LiveMessageSegment[];
  currentRoomFanMedalLevel?: number;
  followedUser?: boolean;
  highlighted?: boolean;
  isSelf?: boolean;
  superChatPrice?: number;
  superChatDuration?: number;
  superChatColor?: string;
};

export type DanmakuItem = DisplayMessageItem & {
  track: number;
  duration: number;
  delay: number;
  createdAt: number;
  /** 视频回填弹幕的偏移量（ms）：拖动进度条后清屏时按它把这些弹幕留下来。 */
  videoOffsetMs?: number;
};

export type VerticalChatItem = DisplayMessageItem & {
  createdAt: number;
};

export type LiveMessage = {
  id: string;
  roomId?: number;
  senderUid?: number;
  currentRoomFanMedal?: "yes" | "no" | "unknown";
  currentRoomFanMedalLevel?: number;
  kind: LiveMessageKind;
  user: string;
  text: string;
  segments?: LiveMessageSegment[];
  isSelf?: boolean;
  // 抽奖弹幕：B 站给为参与天选 / 红包抽奖自动发出的弹幕打的标记（协议字段 info[0][9]）。
  isLottery?: boolean;
  timestamp?: number;
  giftName?: string;
  giftCount?: number;
  guardLevel?: 1 | 2 | 3;
  guardName?: "总督" | "提督" | "舰长";
  superChatPrice?: number;
  superChatDuration?: number;
  superChatColor?: string;
};

export type QueuedLiveMessage = LiveMessage & {
  attempts: number;
  followedUser?: boolean;
  highlighted?: boolean;
  queuedAt: number;
  sourceLabel?: string;
  sourceColorIndex?: number;
  sourceSessionId?: string;
  sourceRoomId?: number;
  sourceAnchorName?: string;
  sourceFanMedalName?: string;
  /**
   * 视频弹幕专用：这条消息比当前播放位置"晚"了多少毫秒。
   * 拖动进度条后后端会回填目标位置之前的弹幕，靠它算出负的动画延迟，
   * 让这些弹幕直接出现在屏幕中段，而不是从右边重新滚一遍。
   */
  videoOffsetMs?: number;
};

export type SendDanmakuStatus = {
  canSend: boolean;
  reason: string;
  roomId?: number;
  anchorName?: string;
  status: RoomSessionStatus | null;
  cooldownMs: number;
};

export type SendDanmakuResult = {
  code: number;
  message: string;
  cooldownMs: number;
};
