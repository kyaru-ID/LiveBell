/**
 * 把「本轮开播开始时间」格式化成卡片上的已开播时长。
 *
 * 口径（用户定的）：
 * - 不足 1 分钟：小于 1 分钟
 * - 不足 1 小时：23 分钟
 * - 不足 1 天：1 小时 23 分
 * - 超过 1 天：1 天 3 小时（不再显示分钟）
 *
 * 时间不可解析时返回 null，调用方据此不渲染。
 */
export function formatLiveDuration(
  startedAt: string | undefined,
  now: number = Date.now(),
): string | null {
  if (!startedAt) {
    return null;
  }
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) {
    return null;
  }
  // 本机时间被往回调过时会算出负数，按「刚开始」处理。
  const elapsedMinutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (elapsedMinutes < 1) {
    return "小于 1 分钟";
  }

  const days = Math.floor(elapsedMinutes / (60 * 24));
  const hours = Math.floor((elapsedMinutes % (60 * 24)) / 60);
  const minutes = elapsedMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  }
  return `${minutes} 分钟`;
}
