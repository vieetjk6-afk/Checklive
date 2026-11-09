import { useState } from 'react';
import { fmtNum } from '../lib/format';
import type { Stats } from '../lib/types';
import { Avatar, PlatformBadge } from './ui';

const TABS = [
  { key: 'comments', label: 'Bình luận' },
  { key: 'likes', label: 'Like' },
  { key: 'shares', label: 'Share' },
  { key: 'gifts', label: 'Quà' },
] as const;

export default function TopUsers({ top }: { top: Stats['top'] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('comments');
  const list = top[tab];
  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Top tương tác</h3>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${tab === t.key ? 'bg-white shadow-sm' : 'text-slate-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">Chưa có dữ liệu</p>
      ) : (
        <ol className="space-y-1">
          {list.map((u, i) => (
            <li key={`${u.platform}-${u.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm">
              <span className="w-5 text-right text-xs font-semibold text-slate-400">{i + 1}</span>
              <Avatar name={u.name} url={u.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{u.name ?? u.handle ?? u.id}</div>
                {u.handle && <div className="truncate text-xs text-slate-500">@{u.handle}</div>}
              </div>
              <PlatformBadge platform={u.platform} short />
              <span className="w-14 text-right font-semibold tabular-nums">{fmtNum(u.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
