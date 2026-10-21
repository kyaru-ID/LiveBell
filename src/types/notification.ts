export type NotificationRecord = {
  id: string;
  time: string;
  streamerName: string;
  title: string;
  roomId: string;
  avatarPath?: string | null;
  isRead: boolean;
};

export const FALLBACK_NOTIFICATION_TITLE = "直播已开始";

export function notificationRoomUrl(roomId: string): string | null {
  return /^[1-9]\d*$/.test(roomId.trim())
    ? `https://live.bilibili.com/${roomId.trim()}`
    : null;
}

export function notificationDisplayTitle(record: NotificationRecord): string {
  const title = record.title?.trim();
  return title ? title : FALLBACK_NOTIFICATION_TITLE;
}

export function formatNotificationTime(time: string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
