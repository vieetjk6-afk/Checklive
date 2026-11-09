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

export const vnd = (n: number | null | undefined) => `${nf.format(n ?? 0)}đ`;

export const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Chờ khách xác nhận', cls: 'bg-amber-100 text-amber-800' },
  CONFIRMED: { label: 'Khách đã xác nhận', cls: 'bg-sky-100 text-sky-800' },
  APPROVED: { label: 'Đã chốt', cls: 'bg-emerald-100 text-emerald-800' },
  COMPLETED: { label: 'Hoàn tất', cls: 'bg-slate-200 text-slate-700' },
  CANCELLED: { label: 'Đã huỷ', cls: 'bg-rose-100 text-rose-700' },
  EXPIRED: { label: 'Hết hạn giữ', cls: 'bg-rose-50 text-rose-600' },
};

export const ITEM_STATUS: Record<string, { label: string; cls: string }> = {
  RESERVED: { label: 'Đã giữ hàng', cls: 'text-emerald-700' },
  WAITLIST: { label: 'Chờ hàng', cls: 'text-amber-700' },
  NEEDS_VARIANT: { label: 'Chưa rõ phân loại', cls: 'text-rose-700' },
  CANCELLED: { label: 'Đã huỷ', cls: 'text-slate-400 line-through' },
};

export const HOLD_OPTIONS: { value: number | null; label: string }[] = [
  { value: 30, label: '30 phút' },
  { value: 60, label: '1 giờ' },
  { value: 120, label: '2 giờ' },
  { value: 360, label: '6 giờ' },
  { value: 720, label: '12 giờ' },
  { value: 1440, label: '24 giờ' },
  { value: 2880, label: '48 giờ' },
  { value: 4320, label: '3 ngày' },
  { value: 10080, label: '7 ngày' },
  { value: null, label: 'Không giới hạn' },
];

export function fmtCountdown(until: string | null): string {
  if (!until) return '';
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return 'hết hạn';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `còn ${m} phút`;
  const h = Math.floor(m / 60);
  return h < 48 ? `còn ${h} giờ ${m % 60} phút` : `còn ${Math.floor(h / 24)} ngày`;
}

/** Ngân hàng phổ biến (mã BIN theo NAPAS). Hãy quét thử mã QR trước khi dùng thật. */
export const BANKS: { bin: string; name: string }[] = [
  { bin: '970436', name: 'Vietcombank' },
  { bin: '970415', name: 'VietinBank' },
  { bin: '970418', name: 'BIDV' },
  { bin: '970405', name: 'Agribank' },
  { bin: '970407', name: 'Techcombank' },
  { bin: '970422', name: 'MB Bank' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970423', name: 'TPBank' },
  { bin: '970403', name: 'Sacombank' },
  { bin: '970441', name: 'VIB' },
  { bin: '970443', name: 'SHB' },
  { bin: '970437', name: 'HDBank' },
  { bin: '970448', name: 'OCB' },
  { bin: '970426', name: 'MSB' },
  { bin: '970440', name: 'SeABank' },
  { bin: '970431', name: 'Eximbank' },
  { bin: '970449', name: 'LPBank' },
  { bin: '970454', name: 'BVBank (Timo)' },
];
