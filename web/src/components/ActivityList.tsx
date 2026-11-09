import { fmtNum, fmtTime } from '../lib/format';
import type { Activity } from '../lib/types';
import { PlatformBadge } from './ui';

const LABEL: Record<Activity['type'], { text: string; cls: string }> = {
  share: { text: 'đã share', cls: 'text-emerald-700' },
  follow: { text: 'đã follow', cls: 'text-sky-700' },
  gift: { text: 'tặng', cls: 'text-amber-700' },
};

export default function ActivityList({ items }: { items: Activity[] }) {
  return (
    <div className="card p-3">
      <h3 className="mb-2 text-sm font-semibold">Share · Follow · Quà (mới nhất)</h3>
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">Hiển thị realtime khi đang live</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {items.map((a) => (
            <li key={a.key} className="flex items-center gap-2 text-sm">
              <PlatformBadge platform={a.platform} short />
              <span className="truncate font-medium">{a.user?.name ?? a.user?.handle ?? 'Ai đó'}</span>
              <span className={`shrink-0 ${LABEL[a.type].cls}`}>
                {LABEL[a.type].text}
                {a.type === 'gift' && ` ${a.count > 1 ? `${a.count}× ` : ''}${a.content ?? ''} (${fmtNum(a.value)}💎)`}
              </span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-400">{fmtTime(a.platformTs)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
