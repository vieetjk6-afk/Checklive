/**
 * Định dạng sự kiện chung. Mọi nền tảng (TikTok, Facebook, giả lập…) đều được
 * chuyển về dạng này, nên phần thống kê / game / chốt đơn không cần biết
 * sự kiện đến từ đâu.
 */
export type Platform = 'TIKTOK' | 'FACEBOOK' | 'SIMULATOR';

export const PLATFORMS: Platform[] = ['TIKTOK', 'FACEBOOK', 'SIMULATOR'];

export type LiveEventType = 'comment' | 'like' | 'share' | 'follow' | 'gift' | 'join';

export const EVENT_TYPES: LiveEventType[] = ['comment', 'like', 'share', 'follow', 'gift', 'join'];

export interface LiveUser {
  /** ID người dùng phía nền tảng (ổn định) */
  id: string;
  /** Tên hiển thị */
  name?: string;
  /** TikTok: @username */
  handle?: string;
  avatarUrl?: string;
}

/** Sự kiện do adapter phát ra (chưa gắn phiên / kênh). */
export interface AdapterEvent {
  type: LiveEventType;
  /** ID sự kiện phía nền tảng, dùng để chống trùng */
  externalId?: string;
  user?: LiveUser;
  content?: string;
  /** Số lượng (ví dụ 1 lần bấm like TikTok có thể gửi 15 like) */
  count?: number;
  /** Giá trị (ví dụ kim cương của quà) */
  value?: number;
  /** Thời điểm theo nền tảng (ms). Bỏ trống = thời điểm nhận */
  platformTs?: number;
}

export interface LiveEvent {
  /** ID tạm trong bộ nhớ, dùng làm key hiển thị */
  key: string;
  sessionId: string;
  channelId: string;
  platform: Platform;
  type: LiveEventType;
  externalId?: string;
  user?: LiveUser;
  content?: string;
  count: number;
  value: number;
  platformTs: number;
  receivedAt: number;
  /** Kết quả xử lý chốt đơn (chỉ với bình luận) */
  tag?: string;
  tagKind?: string;
}

export type ChannelStatus =
  | 'connecting' // đang kết nối
  | 'waiting' // kênh chưa lên sóng, đang chờ
  | 'live' // đang nhận dữ liệu
  | 'reconnecting' // mất kết nối, đang thử lại
  | 'ended' // live đã kết thúc
  | 'error' // lỗi không tự khắc phục được (sai token…)
  | 'stopped'; // đã dừng theo dõi

export interface ChannelState {
  channelId: string;
  platform: Platform;
  name: string;
  handle: string;
  status: ChannelStatus;
  message?: string;
  viewers: number;
  externalLiveId?: string;
  updatedAt: number;
}

export interface AdapterCallbacks {
  onEvent(e: AdapterEvent): void;
  onViewers(viewers: number): void;
  onStatus(status: ChannelStatus, message?: string, externalLiveId?: string): void;
}

export interface LiveAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}
