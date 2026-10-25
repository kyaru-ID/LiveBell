/** 进度条左侧时间的输入解析："1:35"、"1:02:03"、纯秒数 "95"，非法返回 null。 */

const SECONDS_PATTERN = /^\d+$/;
const COLON_PATTERN = /^\d{1,3}(:[0-5]?\d){1,2}$/;

/**
 * 把用户输入的时间换算成毫秒。
 * - 带冒号：最后一段是秒、倒数第二段是分、三段时第一段是时；分和秒都必须小于 60。
 * - 纯数字：按秒算（"95" = 1 分 35 秒）。
 * 超过总时长的裁剪交给调用方，这里只负责解析。
 */
export function parseTimeInput(raw: string): number | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  if (SECONDS_PATTERN.test(text)) {
    return Number(text) * 1000;
  }
  if (!COLON_PATTERN.test(text)) {
    return null;
  }
  const parts = text.split(":").map(Number);
  const seconds = parts[parts.length - 1];
  const minutes = parts.length === 3 ? parts[1] : parts[0];
  const hours = parts.length === 3 ? parts[0] : 0;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

/** 毫秒 -> "m:ss"（满一小时用 "h:mm:ss"），进度条两端的只读时间都用它。 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minuteText =
    hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const secondText = String(seconds).padStart(2, "0");
  return (hours > 0 ? hours + ":" : "") + minuteText + ":" + secondText;
}
