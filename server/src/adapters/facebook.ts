import type { AdapterCallbacks, AdapterEvent, LiveAdapter } from '../core/types.js';

export interface FacebookAdapterOptions {
  pageId: string;
  accessToken: string;
  graphVersion: string;
  /** Nếu biết trước ID live video thì dùng luôn, không cần tự dò */
  liveVideoId?: string;
  commentPollMs?: number;
  statsPollMs?: number;
  waitPollMs?: number;
  fetchImpl?: typeof fetch;
}

interface GraphComment {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id: string; name?: string };
}

export class GraphApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public subcode?: number,
  ) {
    super(message);
  }
  /** Token sai / hết hạn / thiếu quyền: thử lại cũng vô ích */
  get isAuthError() {
    return this.code === 190 || this.code === 10 || this.code === 200 || this.code === 102;
  }
  get isRateLimit() {
    return [4, 17, 32, 613, 80001].includes(this.code ?? -1);
  }
}

/** "2026-11-09T10:00:00+0000" -> ms */
export function parseGraphTime(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(t) ? undefined : t;
}

export function mapGraphComment(c: GraphComment): AdapterEvent {
  return {
    type: 'comment',
    externalId: c.id,
    content: c.message ?? '',
    platformTs: parseGraphTime(c.created_time),
    user: c.from ? { id: c.from.id, name: c.from.name } : undefined,
  };
}

/**
 * Đọc live của Fanpage qua Graph API chính thức (cần Page access token).
 * - Tự dò live đang phát của Page (nếu không truyền liveVideoId)
 * - Lấy bình luận bằng cách hỏi liên tục (polling) theo thứ tự mới nhất, tắt bộ lọc bình luận chất lượng thấp
 * - Lấy số người xem, tổng cảm xúc
 */
export class FacebookAdapter implements LiveAdapter {
  private stopped = false;
  private timers: NodeJS.Timeout[] = [];
  private liveVideoId?: string;
  private videoId?: string;
  private seen = new Set<string>();
  private lastReactionTotal?: number;
  private commentBusy = false;
  private failures = 0;
  private fetchImpl: typeof fetch;

  constructor(
    private cb: AdapterCallbacks,
    private opts: FacebookAdapterOptions,
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.cb.onStatus('connecting');
    try {
      await this.graph(`/${this.opts.pageId}`, { fields: 'id,name' });
    } catch (e) {
      this.handleError(e, () => this.start());
      return;
    }
    if (this.opts.liveVideoId) {
      this.liveVideoId = this.opts.liveVideoId;
      this.beginLive();
    } else {
      void this.waitForLive();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    this.cb.onStatus('stopped');
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private later(fn: () => void, ms: number) {
    if (this.stopped) return;
    this.timers.push(setTimeout(fn, ms));
  }

  /** Dò live đang phát của Page; chưa có thì chờ và dò lại. */
  private async waitForLive(message = 'Fanpage chưa lên sóng, đang chờ…') {
    if (this.stopped) return;
    try {
      const res = await this.graph<{ data: { id: string; status: string; video?: { id: string } }[] }>(
        `/${this.opts.pageId}/live_videos`,
        { broadcast_status: '["LIVE"]', fields: 'id,status,title,video{id}', limit: '1' },
      );
      this.failures = 0;
      const live = res.data?.[0];
      if (live) {
        this.liveVideoId = live.id;
        this.videoId = live.video?.id;
        this.beginLive();
        return;
      }
      this.cb.onStatus('waiting', message);
    } catch (e) {
      if (this.handleError(e)) return;
    }
    this.later(() => void this.waitForLive(message), this.opts.waitPollMs ?? 15_000);
  }

  private beginLive() {
    this.seen.clear();
    this.lastReactionTotal = undefined;
    this.cb.onStatus('live', undefined, this.liveVideoId);
    void this.pollComments();
    void this.pollStats();
  }

  private async pollComments() {
    if (this.stopped || !this.liveVideoId || this.commentBusy) return;
    this.commentBusy = true;
    try {
      await this.fetchNewComments();
      this.failures = 0;
    } catch (e) {
      if (this.handleError(e)) return;
    } finally {
      this.commentBusy = false;
    }
    this.later(() => void this.pollComments(), this.opts.commentPollMs ?? 2_000);
  }

  /** Lấy bình luận mới nhất; nếu cả trang đều mới thì lấy thêm trang sau (tối đa 5 trang). */
  async fetchNewComments(): Promise<number> {
    const fresh: GraphComment[] = [];
    let after: string | undefined;
    for (let page = 0; page < 5; page++) {
      const params: Record<string, string> = {
        order: 'reverse_chronological',
        live_filter: 'no_filter',
        filter: 'stream',
        fields: 'id,message,created_time,from{id,name}',
        limit: '100',
      };
      if (after) params.after = after;
      const res = await this.graph<{ data: GraphComment[]; paging?: { cursors?: { after?: string }; next?: string } }>(
        `/${this.liveVideoId}/comments`,
        params,
      );
      const data = res.data ?? [];
      let reachedSeen = false;
      for (const c of data) {
        if (this.seen.has(c.id)) {
          reachedSeen = true;
          break;
        }
        fresh.push(c);
      }
      if (reachedSeen || !res.paging?.next || data.length === 0) break;
      after = res.paging?.cursors?.after;
      if (!after) break;
    }
    // Phát theo thứ tự cũ -> mới
    for (const c of fresh.reverse()) {
      this.seen.add(c.id);
      this.cb.onEvent(mapGraphComment(c));
    }
    return fresh.length;
  }

  private async pollStats() {
    if (this.stopped || !this.liveVideoId) return;
    try {
      const info = await this.graph<{ status?: string; live_views?: number; video?: { id: string } }>(
        `/${this.liveVideoId}`,
        { fields: 'status,live_views,video{id}' },
      );
      this.videoId = info.video?.id ?? this.videoId;
      if (typeof info.live_views === 'number') this.cb.onViewers(info.live_views);

      if (this.videoId) {
        try {
          const r = await this.graph<{ reactions?: { summary?: { total_count?: number } } }>(`/${this.videoId}`, {
            fields: 'reactions.limit(0).summary(total_count)',
          });
          const total = r.reactions?.summary?.total_count;
          if (typeof total === 'number') {
            // Facebook chỉ cho tổng số cảm xúc, không cho biết ai thả -> ghi nhận phần tăng thêm
            if (this.lastReactionTotal !== undefined && total > this.lastReactionTotal) {
              this.cb.onEvent({ type: 'like', count: total - this.lastReactionTotal });
            } else if (this.lastReactionTotal === undefined && total > 0) {
              this.cb.onEvent({ type: 'like', count: total });
            }
            this.lastReactionTotal = Math.max(total, this.lastReactionTotal ?? 0);
          }
        } catch {
          // Không lấy được cảm xúc thì bỏ qua, không ảnh hưởng bình luận
        }
      }

      if (info.status && info.status !== 'LIVE') {
        // Live đã tắt: lấy nốt bình luận cuối rồi quay lại chờ live mới
        try {
          await this.fetchNewComments();
        } catch {
          /* bỏ qua */
        }
        this.clearTimers();
        this.liveVideoId = undefined;
        this.videoId = undefined;
        this.cb.onStatus('ended', 'Live đã kết thúc. Đang chờ nếu kênh lên sóng lại…');
        this.cb.onViewers(0);
        this.later(() => void this.waitForLive('Live đã kết thúc. Đang chờ nếu kênh lên sóng lại…'), 15_000);
        return;
      }
    } catch (e) {
      if (this.handleError(e)) return;
    }
    this.later(() => void this.pollStats(), this.opts.statsPollMs ?? 10_000);
  }

  /**
   * Xử lý lỗi. Trả về true nếu đã dừng hẳn (lỗi xác thực).
   * Với lỗi tạm thời: báo trạng thái "reconnecting" và để vòng lặp tự thử lại.
   */
  private handleError(e: unknown, retry?: () => void): boolean {
    const err = e instanceof Error ? e : new Error(String(e));
    if (err instanceof GraphApiError && err.isAuthError) {
      this.stopped = true;
      this.clearTimers();
      this.cb.onStatus('error', `Facebook từ chối truy cập: ${err.message}. Kiểm tra lại Page access token / quyền.`);
      return true;
    }
    this.failures++;
    const wait = err instanceof GraphApiError && err.isRateLimit ? 60_000 : Math.min(30_000, 2_000 * this.failures);
    this.cb.onStatus('reconnecting', `Lỗi tạm thời: ${err.message}. Thử lại sau ${Math.round(wait / 1000)}s`);
    if (retry) this.later(retry, wait);
    return false;
  }

  private async graph<T = unknown>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.opts.graphVersion}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', this.opts.accessToken);
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string; code?: number; error_subcode?: number } };
    if (!res.ok || body.error) {
      throw new GraphApiError(body.error?.message ?? `HTTP ${res.status}`, body.error?.code, body.error?.error_subcode);
    }
    return body as T;
  }
}

/** Kiểm tra nhanh Page + token: trả về tên Page và Page có đang live không. */
export async function checkFacebookPage(
  pageId: string,
  accessToken: string,
  graphVersion: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ name: string; isLive: boolean }> {
  const base = `https://graph.facebook.com/${graphVersion}`;
  const get = async (path: string, params: Record<string, string>) => {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', accessToken);
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json()) as any;
    if (!res.ok || body.error) throw new GraphApiError(body.error?.message ?? `HTTP ${res.status}`, body.error?.code);
    return body;
  };
  const page = await get(`/${pageId}`, { fields: 'id,name' });
  const lives = await get(`/${pageId}/live_videos`, { broadcast_status: '["LIVE"]', fields: 'id', limit: '1' });
  return { name: page.name, isLive: (lives.data ?? []).length > 0 };
}
