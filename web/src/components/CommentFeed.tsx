import { useMemo, useState } from 'react';
import { fmtTime } from '../lib/format';
import { norm, splitPhones } from '../lib/text';
import type { Comment, Platform } from '../lib/types';
import { Avatar, PlatformBadge } from './ui';

interface Props {
  comments: Comment[];
  platforms: Platform[];
  live: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Có sản phẩm bán trong phiên thì hiện nút tạo đơn thủ công */
  onCreateOrder?: (c: Comment) => void;
}

const TAG_STYLE: Record<string, string> = {
  order: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  waitlist: 'bg-amber-50 text-amber-800 ring-amber-200',
  warn: 'bg-rose-50 text-rose-700 ring-rose-200',
  question: 'bg-sky-50 text-sky-700 ring-sky-200',
};

type Only = '' | 'phone' | 'order' | 'question';

export default function CommentFeed({ comments, platforms, live, canLoadMore, loadingMore, onLoadMore, onCreateOrder }: Props) {
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState<Only>('');
  const [paused, setPaused] = useState<Comment[] | null>(null);

  const source = paused ?? comments;
  const newWhilePaused = paused ? comments.length - paused.length : 0;

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return source.filter((c) => {
      if (platform && c.platform !== platform) return false;
      if (only === 'phone' && c.phones.length === 0) return false;
      if (only === 'order' && c.tagKind !== 'order' && c.tagKind !== 'waitlist') return false;
      if (only === 'question' && c.tagKind !== 'question' && c.tagKind !== 'warn') return false;
      if (q && !norm(`${c.content} ${c.user?.name ?? ''} ${c.user?.handle ?? ''}`).includes(q)) return false;
      return true;
    });
  }, [source, platform, search, only]);

  return (
    <div className="card flex h-[640px] flex-col">
      <div className="space-y-2 border-b border-slate-100 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Bình luận <span className="font-normal text-slate-500">({filtered.length}{filtered.length !== source.length ? `/${source.length}` : ''})</span>
          </h3>
          {live && (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setPaused(paused ? null : comments)}>
              {paused ? `▶ Tiếp tục${newWhilePaused > 0 ? ` (+${newWhilePaused})` : ''}` : '⏸ Tạm dừng'}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-0 flex-1 py-1.5" placeholder="Tìm nội dung, tên… (không cần dấu)" value={search} onChange={(e) => setSearch(e.target.value)} />
          {platforms.length > 1 && (
            <select className="input w-auto py-1.5" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')}>
              <option value="">Tất cả</option>
              {platforms.map((p) => (
                <option key={p} value={p}>{p === 'TIKTOK' ? 'TikTok' : p === 'FACEBOOK' ? 'Facebook' : 'Giả lập'}</option>
              ))}
            </select>
          )}
          <select className="input w-auto py-1.5" value={only} onChange={(e) => setOnly(e.target.value as Only)} aria-label="Lọc bình luận">
            <option value="">Mọi bình luận</option>
            <option value="phone">Có SĐT</option>
            {onCreateOrder && <option value="order">Đã tạo đơn</option>}
            {onCreateOrder && <option value="question">Câu hỏi / cần xem</option>}
          </select>
        </div>
      </div>
      <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
        {filtered.map((c) => (
          <li key={c.key} className={`flex gap-2 px-3 py-2 ${c.phones.length ? 'bg-amber-50/60' : ''}`}>
            <Avatar name={c.user?.name} url={c.user?.avatarUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs">
                <PlatformBadge platform={c.platform} short />
                <span className="truncate font-semibold text-slate-800">{c.user?.name ?? c.user?.handle ?? 'Ẩn danh'}</span>
                {c.user?.handle && c.user.handle !== c.user.name && <span className="truncate text-slate-400">@{c.user.handle}</span>}
                <span className="ml-auto shrink-0 tabular-nums text-slate-400">{fmtTime(c.platformTs)}</span>
              </div>
              <p className="mt-0.5 break-words text-sm text-slate-800">
                {splitPhones(c.content, c.phones).map((part, i) =>
                  part.phone ? (
                    <mark key={i} className="rounded bg-amber-200 px-0.5 font-semibold text-amber-900">{part.text}</mark>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </p>
              {(c.tag || (onCreateOrder && c.user)) && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {c.tag && (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${TAG_STYLE[c.tagKind ?? 'warn']}`}>{c.tag}</span>
                  )}
                  {onCreateOrder && c.user && c.tagKind !== 'order' && (
                    <button className="rounded px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50" onClick={() => onCreateOrder(c)}>
                      + Tạo đơn
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
        {filtered.length === 0 && <li className="p-8 text-center text-sm text-slate-400">{live ? 'Đang chờ bình luận…' : 'Không có bình luận'}</li>}
        {canLoadMore && (
          <li className="p-3 text-center">
            <button className="btn-ghost py-1.5 text-xs" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? 'Đang tải…' : 'Tải bình luận cũ hơn'}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
