import type { ChannelStatus, Platform, SessionStatus } from './types';

export const nf = new Intl.NumberFormat('vi-VN');

export function fmtNum(n: number | undefined | null): string {
  return nf.format(n ?? 0);
}

export function fmtTime(ts: number | string | null | undefined): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDateTime(ts: number | string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDuration(from: string | null, to: string | null): string {
  if (!from) return '—';
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} giờ ${m % 60} phút` : `${m} phút`;
}

export const PLATFORM_LABEL: Record<Platform, string> = { TIKTOK: 'TikTok', FACEBOOK: 'Facebook', SIMULATOR: 'Giả lập' };

export const PLATFORM_STYLE: Record<Platform, string> = {
  TIKTOK: 'bg-slate-900 text-white',
  FACEBOOK: 'bg-blue-600 text-white',
  SIMULATOR: 'bg-amber-100 text-amber-800',
};

export const SESSION_STATUS: Record<SessionStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'Chưa bắt đầu', cls: 'bg-slate-100 text-slate-700' },
  RUNNING: { label: 'Đang theo dõi', cls: 'bg-emerald-100 text-emerald-700' },
  ENDED: { label: 'Đã kết thúc', cls: 'bg-slate-200 text-slate-600' },
};

export const CHANNEL_STATUS: Record<ChannelStatus, { label: string; dot: string }> = {
  connecting: { label: 'Đang kết nối', dot: 'bg-amber-400 animate-pulse' },
  waiting: { label: 'Chờ lên sóng', dot: 'bg-sky-400 animate-pulse' },
  live: { label: 'Đang live', dot: 'bg-rose-500 animate-pulse' },
  reconnecting: { label: 'Đang kết nối lại', dot: 'bg-amber-500 animate-pulse' },
  ended: { label: 'Live đã kết thúc', dot: 'bg-slate-400' },
  error: { label: 'Lỗi', dot: 'bg-red-600' },
  stopped: { label: 'Đã dừng', dot: 'bg-slate-300' },
};
