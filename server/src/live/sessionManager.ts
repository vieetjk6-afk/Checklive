import type { DB } from '../db.js';
import { extractPhones } from '../core/text.js';
import type { AdapterEvent, ChannelState, LiveAdapter, LiveEvent, LiveUser, Platform } from '../core/types.js';
import type { AdapterFactory } from '../adapters/index.js';
import { loadAggregator, saveAggregates, saveEvents } from './persistence.js';
import type { StatsAggregator, StatsSnapshot } from './stats.js';
import type { OrderService } from '../sales/orderService.js';
import type { GameService } from '../games/gameService.js';

/** Bình luận gửi xuống giao diện */
export interface CommentDTO {
  key: string;
  channelId: string;
  platform: Platform;
  user?: LiveUser;
  content: string;
  phones: string[];
  platformTs: number;
  receivedAt: number;
  tag?: string;
  tagKind?: string;
}

/** Hoạt động khác (share, follow, quà) gửi xuống giao diện */
export interface ActivityDTO {
  key: string;
  channelId: string;
  platform: Platform;
  type: 'share' | 'follow' | 'gift';
  user?: LiveUser;
  content?: string;
  count: number;
  value: number;
  platformTs: number;
}

export type SessionEvent = 'state' | 'stats' | 'comment' | 'activity' | 'ended' | 'commentTag' | 'order' | 'products' | 'game' | 'gameAnswer';

export interface Broadcaster {
  toSession(sessionId: string, event: SessionEvent, payload: unknown): void;
}

export class SessionConflictError extends Error {}

export function toCommentDTO(e: LiveEvent): CommentDTO {
  const content = e.content ?? '';
  return {
    key: e.key,
    channelId: e.channelId,
    platform: e.platform,
    user: e.user,
    content,
    phones: extractPhones(content),
    platformTs: e.platformTs,
    receivedAt: e.receivedAt,
    tag: e.tag,
    tagKind: e.tagKind,
  };
}

const DEDUPE_LIMIT = 20_000;

class RunningSession {
  readonly adapters = new Map<string, LiveAdapter>();
  readonly states = new Map<string, ChannelState>();
  private buffer: LiveEvent[] = [];
  private seq = 0;
  private seen = new Set<string>();
  private statsDirty = true;
  private timers: NodeJS.Timeout[] = [];
  private flushing = false;
  private lastPeak = -1;
  private lastChannelInfo = new Map<string, string>();
  /** Hàng đợi xử lý chốt đơn: xử lý tuần tự theo thứ tự bình luận đến */
  private salesQueue: Promise<void> = Promise.resolve();
  /** Hàng đợi xử lý câu trả lời game (tách riêng để không làm chậm chốt đơn) */
  private gameQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly stats: StatsAggregator,
    private db: DB,
    private out: Broadcaster,
    private sales?: OrderService,
    private games?: GameService,
  ) {}

  /** Chờ xử lý xong các bình luận đang trong hàng đợi */
  async drain(): Promise<void> {
    await Promise.all([this.salesQueue, this.gameQueue]);
  }

  startTimers() {
    this.timers.push(setInterval(() => this.pushStats(), 1000));
    this.timers.push(setInterval(() => void this.flushEvents(), 1000));
    this.timers.push(setInterval(() => void this.flushAggregates(), 5000));
  }

  stopTimers() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  handleEvent(channelId: string, platform: Platform, ae: AdapterEvent) {
    if (ae.externalId) {
      const k = `${channelId}|${ae.externalId}`;
      if (this.seen.has(k)) return;
      this.seen.add(k);
      if (this.seen.size > DEDUPE_LIMIT) {
        // Xoá bớt phần cũ nhất
        const it = this.seen.values();
        for (let i = 0; i < DEDUPE_LIMIT / 2; i++) this.seen.delete(it.next().value as string);
      }
    }
    const now = Date.now();
    const e: LiveEvent = {
      key: `${channelId.slice(-6)}-${++this.seq}`,
      sessionId: this.id,
      channelId,
      platform,
      type: ae.type,
      externalId: ae.externalId,
      user: ae.user,
      content: ae.content,
      count: Math.max(1, Math.round(ae.count ?? 1)),
      value: Math.max(0, Math.round(ae.value ?? 0)),
      platformTs: ae.platformTs ?? now,
      receivedAt: now,
    };
    this.stats.add(e);
    this.statsDirty = true;

    if (e.type === 'comment') {
      this.out.toSession(this.id, 'comment', toCommentDTO(e));
      const games = this.games;
      if (games) {
        this.gameQueue = this.gameQueue.then(() =>
          games
            .handleComment(this.id, { platform, user: e.user, content: e.content ?? '', platformTs: e.platformTs, receivedAt: e.receivedAt })
            .catch((err) => console.error(`[session ${this.id}] lỗi xử lý game`, err)),
        );
      }
      const sales = this.sales;
      if (sales) {
        // Lưu bình luận sau khi xử lý chốt đơn xong để lưu kèm kết quả (tag)
        this.salesQueue = this.salesQueue
          .then(async () => {
            try {
              const out = await sales.handleComment(this.id, { platform, user: e.user, content: e.content ?? '' });
              if (out.tag) {
                e.tag = out.tag;
                e.tagKind = out.tagKind;
                this.out.toSession(this.id, 'commentTag', { key: e.key, tag: out.tag, tagKind: out.tagKind, orderId: out.orderId });
              }
            } catch (err) {
              console.error(`[session ${this.id}] lỗi xử lý chốt đơn`, err);
              e.tag = 'Lỗi khi tạo đơn — hãy tạo thủ công';
              e.tagKind = 'warn';
              this.out.toSession(this.id, 'commentTag', { key: e.key, tag: e.tag, tagKind: e.tagKind });
            }
          })
          .finally(() => this.buffer.push(e));
        return;
      }
    }
    if (e.type !== 'join') this.buffer.push(e);

    if (e.type === 'share' || e.type === 'follow' || e.type === 'gift') {
      const a: ActivityDTO = {
        key: e.key, channelId, platform, type: e.type, user: e.user, content: e.content,
        count: e.count, value: e.value, platformTs: e.platformTs,
      };
      this.out.toSession(this.id, 'activity', a);
    }
  }

  handleViewers(channelId: string, platform: Platform, viewers: number) {
    this.stats.setViewers(channelId, platform, Math.max(0, Math.round(viewers)));
    const st = this.states.get(channelId);
    if (st) st.viewers = viewers;
    this.statsDirty = true;
  }

  handleStatus(channelId: string, status: ChannelState['status'], message?: string, externalLiveId?: string) {
    const st = this.states.get(channelId);
    if (!st) return;
    st.status = status;
    st.message = message;
    if (externalLiveId) st.externalLiveId = externalLiveId;
    st.updatedAt = Date.now();
    this.out.toSession(this.id, 'state', this.channelStates());
  }

  channelStates(): ChannelState[] {
    return [...this.states.values()];
  }

  private pushStats() {
    if (!this.statsDirty) return;
    this.statsDirty = false;
    this.out.toSession(this.id, 'stats', this.stats.snapshot());
  }

  async flushEvents() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await saveEvents(this.db, batch);
    } catch (err) {
      console.error(`[session ${this.id}] lưu sự kiện lỗi, sẽ thử lại`, err);
      this.buffer = batch.concat(this.buffer);
    }
  }

  async flushAggregates() {
    if (this.flushing) return;
    this.flushing = true;
    const { users, minutes } = this.stats.takeDirty();
    try {
      await saveAggregates(this.db, this.id, users, minutes);
      if (this.stats.peakViewers !== this.lastPeak) {
        this.lastPeak = this.stats.peakViewers;
        await this.db.liveSession.update({ where: { id: this.id }, data: { peakViewers: this.stats.peakViewers } });
      }
      for (const st of this.states.values()) {
        const peak = this.stats.peakByChannel.get(st.channelId) ?? 0;
        const sig = `${peak}|${st.externalLiveId ?? ''}`;
        if (this.lastChannelInfo.get(st.channelId) === sig) continue;
        this.lastChannelInfo.set(st.channelId, sig);
        await this.db.sessionChannel.updateMany({
          where: { sessionId: this.id, channelId: st.channelId },
          data: { peakViewers: peak, externalLiveId: st.externalLiveId ?? null },
        });
      }
    } catch (err) {
      console.error(`[session ${this.id}] lưu thống kê lỗi, sẽ thử lại`, err);
      this.stats.markDirty(users, minutes);
    } finally {
      this.flushing = false;
    }
  }

  async flushAll() {
    await this.flushEvents();
    await this.flushAggregates();
  }
}

/**
 * Quản lý các phiên live đang chạy: bật/tắt kết nối từng kênh,
 * gom sự kiện vào thống kê, lưu CSDL và đẩy realtime xuống giao diện.
 */
export class SessionManager {
  private running = new Map<string, RunningSession>();

  constructor(
    private db: DB,
    private out: Broadcaster,
    private createAdapter: AdapterFactory,
    private sales?: OrderService,
    private games?: GameService,
  ) {}

  /** Like / share / follow của 1 người trong phiên (dùng cho điều kiện game) */
  async userActivity(sessionId: string, platform: Platform, platformUserId: string) {
    const live = this.running.get(sessionId)?.stats.getUser(platform, platformUserId);
    if (live) return { likes: live.likes, shares: live.shares, follows: live.follows };
    const row = await this.db.sessionUser.findUnique({
      where: { sessionId_platform_platformUserId: { sessionId, platform, platformUserId } },
    });
    return row ? { likes: row.likes, shares: row.shares, follows: row.follows } : undefined;
  }

  setGames(games: GameService) {
    this.games = games;
  }

  isRunning(sessionId: string) {
    return this.running.has(sessionId);
  }

  async start(sessionId: string): Promise<void> {
    if (this.running.has(sessionId)) return;
    const session = await this.db.liveSession.findUnique({
      where: { id: sessionId },
      include: { channels: { include: { channel: true } } },
    });
    if (!session) throw new Error('Không tìm thấy phiên live');
    if (session.channels.length === 0) throw new SessionConflictError('Phiên live chưa có kênh nào');

    // Mỗi kênh chỉ được chạy trong 1 phiên tại một thời điểm
    const channelIds = session.channels.map((c) => c.channelId);
    for (const [otherId] of this.running) {
      const other = await this.db.sessionChannel.findFirst({
        where: { sessionId: otherId, channelId: { in: channelIds } },
        include: { channel: true, session: true },
      });
      if (other) {
        throw new SessionConflictError(
          `Kênh "${other.channel.name}" đang chạy trong phiên "${other.session.title}". Hãy kết thúc phiên đó trước.`,
        );
      }
    }

    const stats = await loadAggregator(this.db, sessionId);
    const rs = new RunningSession(sessionId, stats, this.db, this.out, this.sales, this.games);
    this.running.set(sessionId, rs);

    if (session.status !== 'RUNNING') {
      await this.db.liveSession.update({
        where: { id: sessionId },
        data: { status: 'RUNNING', startedAt: session.startedAt ?? new Date(), endedAt: null },
      });
    }

    for (const sc of session.channels) {
      const ch = sc.channel;
      rs.states.set(ch.id, {
        channelId: ch.id, platform: ch.platform, name: ch.name, handle: ch.handle,
        status: 'connecting', viewers: 0, updatedAt: Date.now(),
      });
      const adapter = this.createAdapter(
        { id: ch.id, platform: ch.platform, handle: ch.handle, accessToken: ch.accessToken, connector: ch.connector },
        {
          onEvent: (e) => rs.handleEvent(ch.id, ch.platform, e),
          onViewers: (n) => rs.handleViewers(ch.id, ch.platform, n),
          onStatus: (s, msg, ext) => rs.handleStatus(ch.id, s, msg, ext),
        },
      );
      rs.adapters.set(ch.id, adapter);
    }
    rs.startTimers();
    this.out.toSession(sessionId, 'state', rs.channelStates());
    for (const [channelId, adapter] of rs.adapters) {
      adapter.start().catch((err) => rs.handleStatus(channelId, 'error', String(err?.message ?? err)));
    }
  }

  /** Kết thúc phiên: ngắt kết nối, lưu nốt dữ liệu. */
  async stop(sessionId: string): Promise<void> {
    const rs = this.running.get(sessionId);
    if (rs) {
      this.running.delete(sessionId);
      await this.detach(rs);
    }
    await this.db.liveSession.update({ where: { id: sessionId }, data: { status: 'ENDED', endedAt: new Date() } });
    this.out.toSession(sessionId, 'ended', {});
  }

  private async detach(rs: RunningSession) {
    rs.stopTimers();
    await Promise.allSettled([...rs.adapters.values()].map((a) => a.stop()));
    await rs.drain();
    await rs.flushAll();
  }

  channelStates(sessionId: string): ChannelState[] | undefined {
    return this.running.get(sessionId)?.channelStates();
  }

  snapshot(sessionId: string): StatsSnapshot | undefined {
    return this.running.get(sessionId)?.stats.snapshot();
  }

  /** Khi server khởi động lại: tiếp tục các phiên đang chạy dở. */
  async resumeRunning(): Promise<void> {
    const sessions = await this.db.liveSession.findMany({ where: { status: 'RUNNING' }, select: { id: true } });
    for (const s of sessions) {
      try {
        await this.start(s.id);
      } catch (err) {
        console.error(`Không thể tiếp tục phiên ${s.id}`, err);
      }
    }
  }

  /** Tắt server: ngắt kết nối và lưu dữ liệu, nhưng giữ trạng thái RUNNING để lần sau chạy tiếp. */
  async shutdown(): Promise<void> {
    const all = [...this.running.values()];
    this.running.clear();
    await Promise.allSettled(all.map((rs) => this.detach(rs)));
  }
}
