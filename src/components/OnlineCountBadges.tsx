import {
  isSourceActive,
  type RoomSessionSnapshot,
} from "../types/roomSession";

/** 右上角最多并排显示几间房的同接明细，其余折叠成「+N」。 */
export const MAX_VISIBLE_ONLINE_ROOMS = 3;

export type OnlineCountEntry = {
  roomId: number;
  online: number;
};

export type OnlineBadge = {
  sessionId: string;
  label: string;
  /** null = 直播间已连上，但 B 站还没推来同接数，先显示占位。 */
  online: number | null;
  colorIndex: number;
};

/**
 * 把各会话的同接数整理成弹幕层右上角要显示的徽章。
 * 顺序跟着会话列表走，只保留仍在收发弹幕的会话（connected / reconnecting），
 * 色号用和弹幕来源标签一致的来源色。
 * 已连上但还没收到同接数的会话也保留，用 online: null 表示占位（B 站首个
 * ONLINE_RANK_COUNT 大约在连接后 20 秒才到，空着会让用户以为功能没生效）。
 */
export function buildOnlineBadges(
  sessions: RoomSessionSnapshot[],
  onlineBySession: Map<string, OnlineCountEntry>,
  sourceColorBySession: Map<string, number>,
): OnlineBadge[] {
  const badges: OnlineBadge[] = [];
  for (const session of sessions) {
    if (!isSourceActive(session.status)) {
      continue;
    }
    const entry = onlineBySession.get(session.sessionId);
    const anchorName = session.anchorName?.trim();
    badges.push({
      sessionId: session.sessionId,
      label:
        anchorName && anchorName.length > 0
          ? anchorName
          : `房间 ${session.roomId ?? session.requestedRoomId}`,
      online: entry ? entry.online : null,
      colorIndex: sourceColorBySession.get(session.sessionId) ?? 0,
    });
  }
  return badges;
}

function formatOnline(online: number | null) {
  return online === null ? "--" : online.toLocaleString("zh-CN");
}

type Props = {
  badges: OnlineBadge[];
};

/**
 * 多房间并行连接时的同接数徽章：只连一间时保持老版「同接 N」的样子；
 * 连了多间时先给一个合计，再并排显示每间（最多 MAX_VISIBLE_ONLINE_ROOMS 间，
 * 其余折叠成「+N」）。
 */
export function OnlineCountBadges({ badges }: Props) {
  if (badges.length === 0) {
    return null;
  }

  if (badges.length === 1) {
    return (
      <div aria-label="同接数" className="danmaku-online-badges">
        <span className="danmaku-online-badge">
          {`同接 ${formatOnline(badges[0].online)}`}
        </span>
      </div>
    );
  }

  // 只要还有房间没收到数字，合计就先显示占位：拿已知的那几间当合计会误导。
  const total = badges.every((badge) => badge.online !== null)
    ? badges.reduce((sum, badge) => sum + (badge.online ?? 0), 0)
    : null;
  const visibleBadges = badges.slice(0, MAX_VISIBLE_ONLINE_ROOMS);
  const hiddenCount = badges.length - visibleBadges.length;

  return (
    <div aria-label="同接数" className="danmaku-online-badges">
      <span className="danmaku-online-badge">
        {`同接 ${formatOnline(total)}`}
      </span>
      {visibleBadges.map((badge) => (
        <span className="danmaku-online-badge" key={badge.sessionId}>
          <i
            aria-hidden="true"
            className="danmaku-online-dot"
            data-source-color={badge.colorIndex}
          />
          <span className="danmaku-online-label">
            {`${badge.label} ${formatOnline(badge.online)}`}
          </span>
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span className="danmaku-online-badge">{`+${hiddenCount}`}</span>
      ) : null}
    </div>
  );
}
