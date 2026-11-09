import { ControlEvent, TikTokLiveConnection, UserOfflineError, WebcastEvent } from 'tiktok-live-connector';
import type { AdapterCallbacks, AdapterEvent, LiveAdapter, LiveUser } from '../core/types.js';

/**
 * Khai báo kiểu của thư viện (typed-emitter) không đọc được ở chế độ ESM/NodeNext,
 * nên dùng kiểu tối thiểu này cho phần lắng nghe sự kiện.
 */
type Emitter = {
  on(event: string, fn: (...args: any[]) => void): unknown;
  removeAllListeners(): unknown;
};
const asEmitter = (c: TikTokLiveConnection) => c as unknown as Emitter;

export interface TikTokAdapterOptions {
  username: string;
  /** API key Euler Stream (dịch vụ ký request bên thứ ba). Không bắt buộc. */
  signApiKey?: string;
  waitPollMs?: number;
}

/* Thư viện TikTok không chính thức nên kiểu dữ liệu có thể thay đổi giữa các phiên bản.
   Các hàm dưới đây đọc dữ liệu "phòng thủ" để không vỡ khi thiếu trường. */

export function toMs(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(typeof v === 'object' && v !== null && 'toString' in v ? String(v) : v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

export function mapTikTokUser(u: any): LiveUser | undefined {
  if (!u) return undefined;
  const id = String(u.userId ?? u.uniqueId ?? '');
  if (!id) return undefined;
  const avatar =
    u.profilePicture?.url?.[0] ?? u.profilePicture?.urls?.[0] ?? u.profilePictureUrl ?? u.avatarThumb?.urlList?.[0];
  return {
    id,
    name: u.nickname || u.uniqueId || undefined,
    handle: u.uniqueId || undefined,
    avatarUrl: typeof avatar === 'string' ? avatar : undefined,
  };
}

function ts(data: any): number | undefined {
  return toMs(data?.common?.createTime ?? data?.createTime);
}

function msgId(data: any): string | undefined {
  const id = data?.common?.msgId ?? data?.msgId;
  return id ? String(id) : undefined;
}

export function mapChat(data: any): AdapterEvent {
  return { type: 'comment', externalId: msgId(data), user: mapTikTokUser(data.user), content: data.comment ?? '', platformTs: ts(data) };
}

export function mapLike(data: any): AdapterEvent {
  return { type: 'like', user: mapTikTokUser(data.user), count: Number(data.likeCount) || 1, platformTs: ts(data) };
}

/** Quà dạng chuỗi (giftType 1) gửi nhiều sự kiện; chỉ ghi nhận khi chuỗi kết thúc. */
export function mapGift(data: any): AdapterEvent | undefined {
  const giftType = data.giftDetails?.giftType ?? data.giftType;
  if (giftType === 1 && !data.repeatEnd) return undefined;
  const count = Number(data.repeatCount) || 1;
  const diamonds = Number(data.giftDetails?.diamondCount ?? data.extendedGiftInfo?.diamond_count ?? 0) || 0;
  return {
    type: 'gift',
    externalId: msgId(data),
    user: mapTikTokUser(data.user),
    content: data.giftDetails?.giftName ?? data.extendedGiftInfo?.name ?? `Quà #${data.giftId ?? ''}`,
    count,
    value: diamonds * count,
    platformTs: ts(data),
  };
}

/**
 * Đọc live TikTok qua thư viện không chính thức `tiktok-live-connector`.
 * Tự chờ khi kênh chưa live, tự kết nối lại khi rớt mạng.
 */
export class TikTokAdapter implements LiveAdapter {
  private conn?: TikTokLiveConnection;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private failures = 0;

  constructor(
    private cb: AdapterCallbacks,
    private opts: TikTokAdapterOptions,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.teardown();
    this.cb.onStatus('stopped');
  }

  private teardown() {
    const c = this.conn;
    this.conn = undefined;
    if (c) {
      asEmitter(c).removeAllListeners();
      try {
        c.disconnect();
      } catch {
        /* bỏ qua */
      }
    }
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), ms);
  }

  private async connect() {
    if (this.stopped) return;
    this.teardown();
    this.cb.onStatus(this.failures > 0 ? 'reconnecting' : 'connecting');

    const conn = new TikTokLiveConnection(this.opts.username, {
      signApiKey: this.opts.signApiKey || undefined,
      processInitialData: false,
      enableExtendedGiftInfo: false,
    });
    this.conn = conn;
    this.bind(conn);

    try {
      const state = await conn.connect();
      if (this.stopped || this.conn !== conn) return;
      this.failures = 0;
      this.cb.onStatus('live', undefined, state?.roomId ? String(state.roomId) : undefined);
    } catch (e: any) {
      if (this.stopped || this.conn !== conn) return;
      this.teardown();
      if (e instanceof UserOfflineError || /offline|not live|isn't online/i.test(e?.message ?? '')) {
        this.failures = 0;
        this.cb.onStatus('waiting', `@${this.opts.username} chưa lên sóng, đang chờ…`);
        this.schedule(this.opts.waitPollMs ?? 30_000);
        return;
      }
      this.failures++;
      const wait = Math.min(60_000, 5_000 * this.failures);
      this.cb.onStatus('reconnecting', `Không kết nối được TikTok: ${e?.message ?? e}. Thử lại sau ${wait / 1000}s`);
      this.schedule(wait);
    }
  }

  private bind(conn: TikTokLiveConnection) {
    const em = asEmitter(conn);
    const emit = (e: AdapterEvent | undefined) => {
      if (e && this.conn === conn) this.cb.onEvent(e);
    };
    em.on(WebcastEvent.CHAT, (d: any) => emit(mapChat(d)));
    em.on(WebcastEvent.LIKE, (d: any) => emit(mapLike(d)));
    em.on(WebcastEvent.SHARE, (d: any) => emit({ type: 'share', user: mapTikTokUser(d.user), platformTs: ts(d) }));
    em.on(WebcastEvent.FOLLOW, (d: any) => emit({ type: 'follow', user: mapTikTokUser(d.user), platformTs: ts(d) }));
    em.on(WebcastEvent.MEMBER, (d: any) => emit({ type: 'join', user: mapTikTokUser(d.user), platformTs: ts(d) }));
    em.on(WebcastEvent.GIFT, (d: any) => emit(mapGift(d)));
    em.on(WebcastEvent.ROOM_USER, (d: any) => {
      const n = Number(d.viewerCount);
      if (this.conn === conn && Number.isFinite(n)) this.cb.onViewers(n);
    });
    em.on(WebcastEvent.STREAM_END, () => {
      if (this.conn !== conn) return;
      this.teardown();
      this.cb.onViewers(0);
      this.cb.onStatus('ended', 'Live đã kết thúc. Đang chờ nếu kênh lên sóng lại…');
      this.schedule(this.opts.waitPollMs ?? 30_000);
    });
    em.on(ControlEvent.DISCONNECTED, () => {
      if (this.conn !== conn || this.stopped) return;
      this.teardown();
      this.failures++;
      this.cb.onStatus('reconnecting', 'Mất kết nối TikTok, đang kết nối lại…');
      this.schedule(Math.min(60_000, 3_000 * this.failures));
    });
    em.on(ControlEvent.ERROR, (err: any) => {
      if (this.conn !== conn) return;
      // Lỗi lẻ tẻ (giải mã 1 gói tin…) không làm rớt kết nối: chỉ ghi log
      console.warn(`[tiktok:${this.opts.username}]`, err?.info ?? err?.message ?? err);
    });
  }
}

/** Kiểm tra nhanh kênh TikTok có đang live không. */
export async function checkTikTokUser(username: string, signApiKey?: string): Promise<{ isLive: boolean }> {
  const conn = new TikTokLiveConnection(username, { signApiKey: signApiKey || undefined });
  const isLive = await conn.fetchIsLive();
  return { isLive: !!isLive };
}
