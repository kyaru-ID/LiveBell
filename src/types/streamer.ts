/** 后端 streamer_search 返回的主播候选，字段对齐 C# 的 StreamerSearchCandidate。 */
export type StreamerCandidate = {
  avatarUrl?: string;
  name: string;
  roomId?: number;
  uid: number;
};

/** 与 C# StreamerSearchCandidate.RoomText 对齐：没开通直播间时显示「未开播」。 */
export function streamerCandidateRoomText(candidate: StreamerCandidate) {
  return candidate.roomId && candidate.roomId > 0
    ? `房间 ${candidate.roomId}`
    : "未开播";
}

/** 与 C# ConnectRoomDialog.ShowNothingFound 的文案一致。 */
export const STREAMER_NOT_FOUND_HINT =
  "看不出房间号，也没搜到这个主播；房间号、直播间链接、主播名都可以";
