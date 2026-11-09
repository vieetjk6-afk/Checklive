import { describe, expect, it } from 'vitest';
import type { LiveEvent } from '../src/core/types.js';
import { StatsAggregator } from '../src/live/stats.js';

let n = 0;
function ev(p: Partial<LiveEvent>): LiveEvent {
  const t = p.receivedAt ?? Date.UTC(2026, 10, 9, 10, 0, 0);
  return {
    key: String(++n), sessionId: 's', channelId: 'c1', platform: 'TIKTOK', type: 'comment',
    count: 1, value: 0, platformTs: t, receivedAt: t, ...p,
  };
}

describe('StatsAggregator', () => {
  it('đếm tổng, theo nền tảng, theo người dùng', () => {
    const a = new StatsAggregator();
    const u1 = { id: 'u1', name: 'Lan' };
    const u2 = { id: 'u2', name: 'Mai' };
    a.add(ev({ type: 'comment', user: u1, content: 'A1' }));
    a.add(ev({ type: 'comment', user: u1, content: 'A2' }));
    a.add(ev({ type: 'comment', user: u2, content: 'chốt' }));
    a.add(ev({ type: 'like', user: u2, count: 15 }));
    a.add(ev({ type: 'share', user: u1 }));
    a.add(ev({ type: 'gift', user: u2, count: 3, value: 30 }));
    a.add(ev({ type: 'join', user: u1 }));
    a.add(ev({ type: 'comment', platform: 'FACEBOOK', channelId: 'c2', user: { id: 'f1' } }));
    a.add(ev({ type: 'like', platform: 'FACEBOOK', channelId: 'c2', count: 40 })); // FB: không có người like

    const s = a.snapshot();
    expect(s.totals).toMatchObject({ comment: 4, like: 55, share: 1, gift: 3, join: 1, giftValue: 30 });
    expect(s.byPlatform.TIKTOK).toMatchObject({ comment: 3, like: 15 });
    expect(s.byPlatform.FACEBOOK).toMatchObject({ comment: 1, like: 40 });
    expect(s.uniqueCommenters).toBe(3);
    expect(s.top.comments[0]).toMatchObject({ id: 'u1', value: 2 });
    expect(s.top.likes[0]).toMatchObject({ id: 'u2', value: 15 });
    expect(s.top.gifts[0]).toMatchObject({ id: 'u2', value: 30 });
  });

  it('người xem: cộng các kênh, giữ đỉnh', () => {
    const a = new StatsAggregator();
    a.setViewers('c1', 'TIKTOK', 100);
    a.setViewers('c2', 'FACEBOOK', 50);
    expect(a.viewersNow()).toBe(150);
    a.setViewers('c1', 'TIKTOK', 20);
    expect(a.viewersNow()).toBe(70);
    expect(a.peakViewers).toBe(150);
  });

  it('chia theo phút và lưu/khôi phục đúng (hydrate)', () => {
    const a = new StatsAggregator();
    const t0 = Date.UTC(2026, 10, 9, 10, 0, 5);
    a.add(ev({ type: 'comment', user: { id: 'u1' }, receivedAt: t0 }));
    a.add(ev({ type: 'comment', user: { id: 'u1' }, receivedAt: t0 + 60_000 }));
    a.add(ev({ type: 'like', user: { id: 'u2' }, count: 5, receivedAt: t0 + 61_000 }));
    a.add(ev({ type: 'gift', user: { id: 'u2' }, count: 1, value: 99, receivedAt: t0 + 61_000 }));
    expect(a.series().map((p) => p.comments)).toEqual([1, 1]);

    const dirty = a.takeDirty();
    expect(dirty.users).toHaveLength(2);
    expect(dirty.minutes).toHaveLength(2);
    expect(a.takeDirty().users).toHaveLength(0);

    const b = StatsAggregator.hydrate({ users: a.allUsers(), minutes: dirty.minutes, peakViewers: 7 });
    const s = b.snapshot();
    expect(s.totals).toMatchObject({ comment: 2, like: 5, gift: 1, giftValue: 99 });
    expect(s.uniqueCommenters).toBe(1);
    expect(s.peakViewers).toBe(7);
  });
});
