import {
  streamerCandidateRoomText,
  type StreamerCandidate,
} from "../types/streamer";

type StreamerCandidateListProps = {
  candidates: StreamerCandidate[];
  onSelect: (candidate: StreamerCandidate) => void;
};

/** 搜到的主播候选列表：点头像名字那一行即选中，与 C# 的候选按钮同一套外观。 */
export function StreamerCandidateList({
  candidates,
  onSelect,
}: StreamerCandidateListProps) {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--drift-ui-candidate-border)] bg-[var(--drift-ui-candidate-bg)] p-1 shadow-[var(--drift-ui-candidate-shadow)]">
      {candidates.map((candidate) => (
        <button
          aria-label={`选择主播 ${candidate.name}`}
          // bg-transparent 必须显式写：仓库没引入 Tailwind preflight，<button> 会带浏览器默认的
          // 灰底（buttonface #f0f0f0），白色卡片会被这层灰盖住，看起来像「未选中就是灰/粉色」。
          className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left hover:bg-[var(--drift-ui-candidate-hover)]"
          key={candidate.uid}
          onClick={() => onSelect(candidate)}
          type="button"
        >
          {candidate.avatarUrl ? (
            <img
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover"
              // B 站头像有防盗链：不带 Referer 才拿得到，webview 默认 Referer 会被 403。
              referrerPolicy="no-referrer"
              src={candidate.avatarUrl}
            />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-xs">
              {candidate.name.slice(0, 1)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[var(--drift-ui-candidate-name)]">
              {candidate.name}
            </span>
            <span className="block text-[11px] text-[var(--drift-ui-candidate-uid)]">
              UID {candidate.uid}
            </span>
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-[var(--drift-ui-candidate-room)]">
            {streamerCandidateRoomText(candidate)}
          </span>
        </button>
      ))}
    </div>
  );
}
