import crypto from 'node:crypto';
import type { AdapterCallbacks, AdapterEvent, LiveAdapter } from '../core/types.js';

/** 1 bình luận tiện ích Chrome đọc được trên trang Facebook */
export interface ExtComment {
  /** ID bình luận phía Facebook (comment_id) nếu đọc được */
  id?: string;
  author: { name: string; id?: string; url?: string; avatar?: string };
  text: string;
  /** Thời điểm tiện ích thấy bình luận (ms) */
  ts?: number;
}

export interface ExtPayload {
  pageUrl?: string;
  pageTitle?: string;
  viewers?: number | null;
  comments?: ExtComment[];
}

/** Sau bao lâu không nhận được gì từ tiện ích thì coi là mất kết nối */
export const EXT_TIMEOUT_MS = 45_000;

/** Bỏ chữ "Xem thêm" khi Facebook rút gọn bình luận dài */
export function cleanText(text: string): string {
  return text
    .replace(/\s*(…|\.\.\.)?\s*(Xem thêm|See more)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chuyển bình luận từ tiện ích về định dạng sự kiện chung */
export function mapExtComment(c: ExtComment, now = Date.now()): AdapterEvent | undefined {
  const name = (c.author?.name ?? '').trim().slice(0, 100);
  const text = cleanText(String(c.text ?? '')).slice(0, 2000);
  if (!name || !text) return undefined;
  // Không đọc được ID người dùng thì dùng tên (kém ổn định hơn: trùng tên sẽ bị gộp)
  const userId = c.author.id?.trim() ? String(c.author.id).trim().slice(0, 100) : `name:${name}`;
  const ts = Number(c.ts);
  return {
    type: 'comment',
    externalId: c.id
      ? `fb:${String(c.id).slice(0, 200)}`
      : `h:${crypto.createHash('sha1').update(`${userId}|${text}|${Math.floor((Number.isFinite(ts) ? ts : now) / 120_000)}`).digest('hex')}`,
    user: { id: userId, name, avatarUrl: c.author.avatar?.startsWith('http') ? c.author.avatar : undefined },
    content: text,
    // Không cho thời điểm ở tương lai hoặc quá cũ (đồng hồ máy người dùng có thể lệch)
    platformTs: Number.isFinite(ts) && ts <= now + 2000 && ts > now - 10 * 60_000 ? ts : now,
  };
}

/**
 * Kênh nhận dữ liệu từ tiện ích Chrome. Không tự kết nối đi đâu cả:
 * tiện ích gửi bình luận lên server, server chuyển vào đây.
 */
export class ExtensionAdapter implements LiveAdapter {
  private lastSeen = 0;
  private timer?: NodeJS.Timeout;
  private live = false;

  constructor(
    readonly channelId: string,
    private cb: AdapterCallbacks,
    private hub: ExtensionHub,
  ) {}

  async start() {
    this.hub.register(this.channelId, this);
    this.cb.onStatus('waiting', 'Chờ tiện ích Chrome gửi dữ liệu… Mở trang live Facebook và bấm "Bắt đầu" trên tiện ích.');
    this.timer = setInterval(() => {
      if (this.live && Date.now() - this.lastSeen > EXT_TIMEOUT_MS) {
        this.live = false;
        this.cb.onStatus('reconnecting', 'Mất tín hiệu từ tiện ích Chrome (tab bị đóng hoặc máy mất mạng?)');
      }
    }, 5000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.hub.unregister(this.channelId, this);
    this.cb.onStatus('stopped');
  }

  ingest(p: ExtPayload): number {
    this.lastSeen = Date.now();
    if (!this.live) {
      this.live = true;
      this.cb.onStatus('live', p.pageTitle ? `Đang đọc: ${p.pageTitle.slice(0, 80)}` : 'Đang nhận dữ liệu từ tiện ích Chrome', p.pageUrl?.slice(0, 300));
    }
    if (typeof p.viewers === 'number' && Number.isFinite(p.viewers) && p.viewers >= 0) this.cb.onViewers(Math.round(p.viewers));
    let n = 0;
    for (const c of (p.comments ?? []).slice(0, 500)) {
      const e = mapExtComment(c);
      if (!e) continue;
      this.cb.onEvent(e);
      n++;
    }
    return n;
  }
}

/** Nơi tiện ích Chrome tìm đúng kênh đang chạy để gửi dữ liệu vào */
export class ExtensionHub {
  private adapters = new Map<string, ExtensionAdapter>();

  register(channelId: string, a: ExtensionAdapter) {
    this.adapters.set(channelId, a);
  }

  unregister(channelId: string, a: ExtensionAdapter) {
    if (this.adapters.get(channelId) === a) this.adapters.delete(channelId);
  }

  isActive(channelId: string) {
    return this.adapters.has(channelId);
  }

  /** Trả về số bình luận nhận được, hoặc null nếu kênh chưa nằm trong phiên đang chạy */
  push(channelId: string, p: ExtPayload): number | null {
    const a = this.adapters.get(channelId);
    return a ? a.ingest(p) : null;
  }
}
