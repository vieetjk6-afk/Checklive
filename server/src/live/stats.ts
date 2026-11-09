import { type LiveEvent, type LiveEventType, type Platform } from '../core/types.js';

export type Counts = Record<LiveEventType, number> & { giftValue: number };

export interface UserAgg {
  platform: Platform;
  platformUserId: string;
  userName?: string;
  userHandle?: string;
  avatarUrl?: string;
  comments: number;
  likes: number;
  shares: number;
  follows: number;
  gifts: number;
  giftValue: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface MinuteAgg {
  platform: Platform;
  /** đầu phút, ms */
  minute: number;
  comments: number;
  likes: number;
  shares: number;
  follows: number;
  gifts: number;
  joins: number;
  viewersMax: number;
}

export interface TopUser {
  platform: Platform;
  id: string;
  name?: string;
  handle?: string;
  avatarUrl?: string;
  value: number;
}

export interface SeriesPoint {
  minute: number;
  comments: number;
  likes: number;
  shares: number;
  follows: number;
  gifts: number;
  joins: number;
  viewers: number;
}

export interface StatsSnapshot {
  totals: Counts;
  byPlatform: Partial<Record<Platform, Counts>>;
  uniqueCommenters: number;
  uniqueUsers: number;
  viewersNow: number;
  viewersByChannel: Record<string, number>;
  peakViewers: number;
  series: SeriesPoint[];
  top: {
    comments: TopUser[];
    likes: TopUser[];
    shares: TopUser[];
    gifts: TopUser[];
  };
}

const emptyCounts = (): Counts => ({ comment: 0, like: 0, share: 0, follow: 0, gift: 0, join: 0, giftValue: 0 });

const MINUTE = 60_000;

export function minuteOf(ts: number): number {
  return Math.floor(ts / MINUTE) * MINUTE;
}

const userKey = (platform: Platform, id: string) => `${platform}|${id}`;
const minuteKey = (platform: Platform, minute: number) => `${platform}|${minute}`;

/**
 * Bộ tổng hợp thống kê trong bộ nhớ cho 1 phiên live.
 * Ghi nhận từng sự kiện, theo dõi phần đã thay đổi (dirty) để lưu xuống CSDL theo lô.
 */
export class StatsAggregator {
  private totals = emptyCounts();
  private byPlatform = new Map<Platform, Counts>();
  private users = new Map<string, UserAgg>();
  private minutes = new Map<string, MinuteAgg>();
  private dirtyUsers = new Set<string>();
  private dirtyMinutes = new Set<string>();
  private viewers = new Map<string, { platform: Platform; current: number }>();
  peakViewers = 0;
  peakByChannel = new Map<string, number>();

  /** Nạp lại từ dữ liệu đã lưu (khi khởi động lại server hoặc xem báo cáo phiên cũ). */
  static hydrate(input: { users: UserAgg[]; minutes: MinuteAgg[]; peakViewers?: number }): StatsAggregator {
    const agg = new StatsAggregator();
    for (const u of input.users) agg.users.set(userKey(u.platform, u.platformUserId), { ...u });
    for (const m of input.minutes) {
      agg.minutes.set(minuteKey(m.platform, m.minute), { ...m });
      const p = agg.platformCounts(m.platform);
      const add = (c: Counts) => {
        c.comment += m.comments;
        c.like += m.likes;
        c.share += m.shares;
        c.follow += m.follows;
        c.gift += m.gifts;
        c.join += m.joins;
      };
      add(p);
      add(agg.totals);
    }
    for (const u of input.users) {
      agg.totals.giftValue += u.giftValue;
      agg.platformCounts(u.platform).giftValue += u.giftValue;
    }
    agg.peakViewers = input.peakViewers ?? 0;
    return agg;
  }

  private platformCounts(p: Platform): Counts {
    let c = this.byPlatform.get(p);
    if (!c) {
      c = emptyCounts();
      this.byPlatform.set(p, c);
    }
    return c;
  }

  private minuteAgg(platform: Platform, ts: number): MinuteAgg {
    const minute = minuteOf(ts);
    const key = minuteKey(platform, minute);
    let m = this.minutes.get(key);
    if (!m) {
      m = { platform, minute, comments: 0, likes: 0, shares: 0, follows: 0, gifts: 0, joins: 0, viewersMax: 0 };
      this.minutes.set(key, m);
    }
    this.dirtyMinutes.add(key);
    return m;
  }

  add(e: LiveEvent): void {
    const count = e.type === 'like' || e.type === 'gift' ? e.count : 1;
    this.totals[e.type] += count;
    const pc = this.platformCounts(e.platform);
    pc[e.type] += count;
    if (e.type === 'gift') {
      this.totals.giftValue += e.value;
      pc.giftValue += e.value;
    }

    // Thống kê theo phút dùng thời điểm nhận để biểu đồ không bị lệch do đồng hồ nền tảng
    const m = this.minuteAgg(e.platform, e.receivedAt);
    switch (e.type) {
      case 'comment': m.comments += 1; break;
      case 'like': m.likes += count; break;
      case 'share': m.shares += 1; break;
      case 'follow': m.follows += 1; break;
      case 'gift': m.gifts += count; break;
      case 'join': m.joins += 1; break;
    }

    if (!e.user || e.type === 'join') return;
    const key = userKey(e.platform, e.user.id);
    let u = this.users.get(key);
    if (!u) {
      u = {
        platform: e.platform,
        platformUserId: e.user.id,
        comments: 0, likes: 0, shares: 0, follows: 0, gifts: 0, giftValue: 0,
        firstSeenAt: e.platformTs,
        lastSeenAt: e.platformTs,
      };
      this.users.set(key, u);
    }
    u.userName = e.user.name ?? u.userName;
    u.userHandle = e.user.handle ?? u.userHandle;
    u.avatarUrl = e.user.avatarUrl ?? u.avatarUrl;
    u.lastSeenAt = Math.max(u.lastSeenAt, e.platformTs);
    switch (e.type) {
      case 'comment': u.comments += 1; break;
      case 'like': u.likes += count; break;
      case 'share': u.shares += 1; break;
      case 'follow': u.follows += 1; break;
      case 'gift': u.gifts += count; u.giftValue += e.value; break;
    }
    this.dirtyUsers.add(key);
  }

  setViewers(channelId: string, platform: Platform, current: number, at = Date.now()): void {
    this.viewers.set(channelId, { platform, current });
    this.peakByChannel.set(channelId, Math.max(this.peakByChannel.get(channelId) ?? 0, current));
    this.peakViewers = Math.max(this.peakViewers, this.viewersNow());
    const m = this.minuteAgg(platform, at);
    m.viewersMax = Math.max(m.viewersMax, current);
  }

  viewersNow(): number {
    let n = 0;
    for (const v of this.viewers.values()) n += v.current;
    return n;
  }

  takeDirty(): { users: UserAgg[]; minutes: MinuteAgg[] } {
    const users = [...this.dirtyUsers].map((k) => ({ ...this.users.get(k)! }));
    const minutes = [...this.dirtyMinutes].map((k) => ({ ...this.minutes.get(k)! }));
    this.dirtyUsers.clear();
    this.dirtyMinutes.clear();
    return { users, minutes };
  }

  /** Đưa lại phần chưa lưu được vào danh sách chờ lưu (khi ghi CSDL lỗi). */
  markDirty(users: UserAgg[], minutes: MinuteAgg[]): void {
    for (const u of users) this.dirtyUsers.add(userKey(u.platform, u.platformUserId));
    for (const m of minutes) this.dirtyMinutes.add(minuteKey(m.platform, m.minute));
  }

  private top(field: 'comments' | 'likes' | 'shares' | 'giftValue', n = 10): TopUser[] {
    const out: TopUser[] = [];
    for (const u of this.users.values()) {
      if (u[field] > 0) {
        out.push({ platform: u.platform, id: u.platformUserId, name: u.userName, handle: u.userHandle, avatarUrl: u.avatarUrl, value: u[field] });
      }
    }
    return out.sort((a, b) => b.value - a.value).slice(0, n);
  }

  series(): SeriesPoint[] {
    const byMinute = new Map<number, SeriesPoint>();
    for (const m of this.minutes.values()) {
      let p = byMinute.get(m.minute);
      if (!p) {
        p = { minute: m.minute, comments: 0, likes: 0, shares: 0, follows: 0, gifts: 0, joins: 0, viewers: 0 };
        byMinute.set(m.minute, p);
      }
      p.comments += m.comments;
      p.likes += m.likes;
      p.shares += m.shares;
      p.follows += m.follows;
      p.gifts += m.gifts;
      p.joins += m.joins;
      // Gộp người xem các nền tảng trong cùng phút (đỉnh từng nền tảng cộng lại, xấp xỉ)
      p.viewers += m.viewersMax;
    }
    return [...byMinute.values()].sort((a, b) => a.minute - b.minute);
  }

  snapshot(): StatsSnapshot {
    let uniqueCommenters = 0;
    for (const u of this.users.values()) if (u.comments > 0) uniqueCommenters++;
    const byPlatform: Partial<Record<Platform, Counts>> = {};
    for (const [p, c] of this.byPlatform) byPlatform[p] = { ...c };
    const viewersByChannel: Record<string, number> = {};
    for (const [id, v] of this.viewers) viewersByChannel[id] = v.current;
    return {
      totals: { ...this.totals },
      byPlatform,
      uniqueCommenters,
      uniqueUsers: this.users.size,
      viewersNow: this.viewersNow(),
      viewersByChannel,
      peakViewers: this.peakViewers,
      series: this.series(),
      top: {
        comments: this.top('comments'),
        likes: this.top('likes'),
        shares: this.top('shares'),
        gifts: this.top('giftValue'),
      },
    };
  }

  allUsers(): UserAgg[] {
    return [...this.users.values()];
  }
}

