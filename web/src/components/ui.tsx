import type { ReactNode } from 'react';
import { CHANNEL_STATUS, PLATFORM_LABEL, PLATFORM_STYLE } from '../lib/format';
import type { ChannelStatus, Platform } from '../lib/types';

export function PlatformBadge({ platform, short }: { platform: Platform; short?: boolean }) {
  const text = short ? (platform === 'TIKTOK' ? 'TT' : platform === 'FACEBOOK' ? 'FB' : 'GL') : PLATFORM_LABEL[platform];
  return <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${PLATFORM_STYLE[platform]}`}>{text}</span>;
}

export function StatusDot({ status }: { status: ChannelStatus }) {
  const s = CHANNEL_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Avatar({ name, url }: { name?: string; url?: string }) {
  if (url) return <img src={url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />;
  const letter = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">{letter}</span>;
}
