import { fmtNum, PLATFORM_LABEL } from '../lib/format';
import type { Counts, Platform, Stats } from '../lib/types';

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <span className={`h-2 w-2 rounded-full ${accent}`} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-slate-500" title={sub}>{sub}</div>}
    </div>
  );
}

function breakdown(stats: Stats, key: keyof Counts): string | undefined {
  const entries = Object.entries(stats.byPlatform) as [Platform, Counts][];
  if (entries.length < 2) return undefined;
  return entries.map(([p, c]) => `${PLATFORM_LABEL[p]} ${fmtNum(c[key])}`).join(' · ');
}

export default function StatCards({ stats, hasFacebook }: { stats: Stats; hasFacebook: boolean }) {
  const t = stats.totals;
  const fbNote = hasFacebook ? 'Facebook không cung cấp số này' : undefined;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Card label="Người xem" value={fmtNum(stats.viewersNow)} sub={`Cao nhất: ${fmtNum(stats.peakViewers)}`} accent="bg-rose-500" />
      <Card label="Bình luận" value={fmtNum(t.comment)} sub={breakdown(stats, 'comment') ?? `${fmtNum(stats.uniqueCommenters)} người bình luận`} accent="bg-indigo-500" />
      <Card label="Like / cảm xúc" value={fmtNum(t.like)} sub={breakdown(stats, 'like')} accent="bg-pink-500" />
      <Card label="Share" value={fmtNum(t.share)} sub={breakdown(stats, 'share') ?? fbNote} accent="bg-emerald-500" />
      <Card label="Follow mới" value={fmtNum(t.follow)} sub={breakdown(stats, 'follow') ?? fbNote} accent="bg-sky-500" />
      <Card label="Quà tặng" value={fmtNum(t.gift)} sub={`${fmtNum(t.giftValue)} kim cương`} accent="bg-amber-500" />
    </div>
  );
}
