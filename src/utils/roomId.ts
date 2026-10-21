const LIVE_URL_PATTERN =
  /(?:https?:\/\/)?live\.bilibili\.com\/(?:[A-Za-z]+\/)*(\d+)/i;

/**
 * 把用户输入（房间号或直播间链接）解析成规范房间号字符串，无法解析时返回 null。
 * 容忍度对齐 C# 版 RoomIdParser.TryParse：域名后面允许夹路径段，例如
 * https://live.bilibili.com/blanc/33989；/blackboard/activity-xxx.html?id=123
 * 这类路径段后面不是数字则不会误判。
 */
export function roomIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const matched = LIVE_URL_PATTERN.exec(trimmed);
  const digits = matched ? matched[1] : trimmed;
  if (!/^\d+$/.test(digits)) {
    return null;
  }

  const roomId = Number(digits);
  return Number.isSafeInteger(roomId) && roomId > 0 ? String(roomId) : null;
}

export function bilibiliRoomUrl(roomId: string | number): string {
  return `https://live.bilibili.com/${roomId}`;
}
