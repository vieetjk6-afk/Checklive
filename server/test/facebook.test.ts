import { describe, expect, it } from 'vitest';
import { FacebookAdapter, mapGraphComment, parseGraphTime } from '../src/adapters/facebook.js';
import type { AdapterEvent, ChannelStatus } from '../src/core/types.js';

function fakeGraph(routes: Record<string, (url: URL) => unknown>) {
  const calls: URL[] = [];
  const impl = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    const path = url.pathname.replace(/^\/v[\d.]+/, '');
    const handler = routes[path];
    if (!handler) return new Response(JSON.stringify({ error: { message: 'not found', code: 100 } }), { status: 400 });
    const body = handler(url);
    return new Response(JSON.stringify(body), { status: (body as any)?.error ? 400 : 200 });
  }) as typeof fetch;
  return { impl, calls };
}

function collector() {
  const events: AdapterEvent[] = [];
  const statuses: { s: ChannelStatus; m?: string; ext?: string }[] = [];
  const viewers: number[] = [];
  return {
    events, statuses, viewers,
    cb: {
      onEvent: (e: AdapterEvent) => events.push(e),
      onStatus: (s: ChannelStatus, m?: string, ext?: string) => statuses.push({ s, m, ext }),
      onViewers: (n: number) => viewers.push(n),
    },
  };
}

describe('Facebook adapter', () => {
  it('đọc thời gian Graph API', () => {
    expect(parseGraphTime('2026-11-09T10:00:00+0000')).toBe(Date.UTC(2026, 10, 9, 10, 0, 0));
    expect(parseGraphTime(undefined)).toBeUndefined();
  });

  it('chuyển bình luận Graph thành sự kiện chung', () => {
    expect(mapGraphComment({ id: 'c1', message: 'A1 đỏ', created_time: '2026-11-09T10:00:00+0000', from: { id: 'u1', name: 'Lan' } }))
      .toMatchObject({ type: 'comment', externalId: 'c1', content: 'A1 đỏ', user: { id: 'u1', name: 'Lan' } });
  });

  it('lấy bình luận mới, không trùng, đúng thứ tự cũ -> mới, tắt bộ lọc chất lượng thấp', async () => {
    let batch: any[] = [
      { id: 'c2', message: 'hai', created_time: '2026-11-09T10:00:02+0000', from: { id: 'u2', name: 'B' } },
      { id: 'c1', message: 'một', created_time: '2026-11-09T10:00:01+0000', from: { id: 'u1', name: 'A' } },
    ];
    const g = fakeGraph({ '/LIVE1/comments': () => ({ data: batch }) });
    const c = collector();
    const fb = new FacebookAdapter(c.cb, { pageId: 'P', accessToken: 't', graphVersion: 'v26.0', liveVideoId: 'LIVE1', fetchImpl: g.impl });
    (fb as any).liveVideoId = 'LIVE1';

    expect(await fb.fetchNewComments()).toBe(2);
    expect(c.events.map((e) => e.content)).toEqual(['một', 'hai']);
    const q = g.calls[0].searchParams;
    expect(q.get('live_filter')).toBe('no_filter');
    expect(q.get('order')).toBe('reverse_chronological');

    batch = [{ id: 'c3', message: 'ba', from: { id: 'u1' } }, ...batch];
    expect(await fb.fetchNewComments()).toBe(1);
    expect(c.events.map((e) => e.content)).toEqual(['một', 'hai', 'ba']);
  });

  it('tự dò live của Page, báo trạng thái live, lấy người xem; token sai thì báo lỗi', async () => {
    const g = fakeGraph({
      '/P': () => ({ id: 'P', name: 'Shop' }),
      '/P/live_videos': () => ({ data: [{ id: 'LIVE9', status: 'LIVE', video: { id: 'V9' } }] }),
      '/LIVE9/comments': () => ({ data: [] }),
      '/LIVE9': () => ({ status: 'LIVE', live_views: 321, video: { id: 'V9' } }),
      '/V9': () => ({ reactions: { summary: { total_count: 10 } } }),
    });
    const c = collector();
    const fb = new FacebookAdapter(c.cb, { pageId: 'P', accessToken: 't', graphVersion: 'v26.0', fetchImpl: g.impl });
    await fb.start();
    await new Promise((r) => setTimeout(r, 50));
    await fb.stop();
    expect(c.statuses.find((s) => s.s === 'live')?.ext).toBe('LIVE9');
    expect(c.viewers).toContain(321);
    expect(c.events.find((e) => e.type === 'like')?.count).toBe(10);

    const bad = fakeGraph({ '/P': () => ({ error: { message: 'Invalid OAuth access token', code: 190 } }) });
    const c2 = collector();
    const fb2 = new FacebookAdapter(c2.cb, { pageId: 'P', accessToken: 'x', graphVersion: 'v26.0', fetchImpl: bad.impl });
    await fb2.start();
    expect(c2.statuses.at(-1)?.s).toBe('error');
  });
});
