/** 视频弹幕（B 站点播视频的弹幕）相关类型，与后端 bilibili::video 的快照一一对应。 */

export type VideoPageSnapshot = {
  index: number;
  /** 分P 序号（从 1 开始，B 站页面上的 P1/P2）。 */
  page: number;
  part: string;
  durationMs: number;
  active: boolean;
};

export type VideoDanmakuSnapshot = {
  sessionId: string;
  aid: number;
  bvid: string;
  title: string;
  cid: number;
  pageIndex: number;
  pageTitle: string;
  durationMs: number;
  positionMs: number;
  playing: boolean;
  rate: number;
  looping: boolean;
  finished: boolean;
  loading: boolean;
  error?: string | null;
  pages: VideoPageSnapshot[];
};

export type VideoDanmakuProgress = {
  sessionId: string;
  cid: number;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  rate: number;
  looping: boolean;
  loading: boolean;
  finished: boolean;
  error?: string | null;
};

/** 发给后端 video_danmaku_control 的命令（后端 VideoControl 的 serde tag = action）。 */
export type VideoDanmakuControl =
  | { action: "play" }
  | { action: "pause" }
  | { action: "seek"; positionMs: number }
  | { action: "setRate"; rate: number }
  | { action: "setLooping"; looping: boolean }
  | { action: "selectPage"; index: number };
