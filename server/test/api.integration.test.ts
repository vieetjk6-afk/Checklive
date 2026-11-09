import { PrismaClient } from '@prisma/client';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { SimulatorAdapter } from '../src/adapters/simulator.js';
import type { Config } from '../src/config.js';

/**
 * Test tích hợp: chạy server thật với CSDL thật và kênh giả lập.
 * Cần biến TEST_DATABASE_URL (CSDL riêng cho test, đã chạy migrate).
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('API + realtime (kênh giả lập)', () => {
  let db: PrismaClient;
  let built: BuiltApp;
  let base: string;
  let cookie = '';

  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), cookie, ...(init.headers ?? {}) },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, body: body as any, res };
  };

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    await db.shop.deleteMany();
    await db.user.deleteMany();
    const config: Config = {
      DATABASE_URL: url!, PORT: 0, HOST: '127.0.0.1', JWT_SECRET: 'test-secret-0123456789',
      ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'matkhau123', FB_GRAPH_VERSION: 'v26.0',
      NODE_ENV: 'test', WEB_DIST: '/nonexistent',
    };
    built = await buildApp(config, db, {
      logger: false,
      // Giả lập tốc độ cao để test nhanh
      adapterFactory: (ch, cb) => new SimulatorAdapter(cb, { seed: ch.id, eventsPerSecond: 40 }),
    });
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = built.app.server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await built?.app.close();
    await db?.$disconnect();
  });

  it('chặn khi chưa đăng nhập, đăng nhập được', async () => {
    expect((await api('/api/channels')).status).toBe(401);
    expect((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@test.local', password: 'sai' }) })).status).toBe(401);
    const ok = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@test.local', password: 'matkhau123' }) });
    expect(ok.status).toBe(200);
    cookie = ok.res.headers.get('set-cookie')!.split(';')[0];
    expect((await api('/api/auth/me')).body.email).toBe('admin@test.local');
  });

  it('chạy phiên live: nhận bình luận realtime, thống kê, lưu CSDL, xuất Excel', async () => {
    const tk = await api('/api/channels', { method: 'POST', body: JSON.stringify({ platform: 'TIKTOK', handle: 'https://www.tiktok.com/@Shop.ABC/live' }) });
    expect(tk.status).toBe(200);
    expect(tk.body).toMatchObject({ handle: 'shop.abc', name: '@shop.abc', hasAccessToken: false });
    expect((await api('/api/channels', { method: 'POST', body: JSON.stringify({ platform: 'FACEBOOK', handle: '123' }) })).status).toBe(400);
    const sim = await api('/api/channels', { method: 'POST', body: JSON.stringify({ platform: 'SIMULATOR', handle: 'demo' }) });

    const s1 = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ title: 'Live tối thứ 2', channelIds: [tk.body.id, sim.body.id] }) });
    const sessionId = s1.body.id;

    const socket: Socket = connect(base, { path: '/socket.io', extraHeaders: { cookie }, transports: ['websocket'] });
    const comments: any[] = [];
    let lastStats: any = null;
    socket.on('comment', (c) => comments.push(c));
    socket.on('stats', (s) => (lastStats = s));
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    const joined: any = await socket.emitWithAck('join', sessionId);
    expect(joined.ok).toBe(true);

    expect((await api(`/api/sessions/${sessionId}/start`, { method: 'POST' })).status).toBe(200);

    // Kênh chỉ được chạy trong 1 phiên tại 1 thời điểm
    const s2 = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ title: 'Phiên trùng', channelIds: [sim.body.id] }) });
    const conflict = await api(`/api/sessions/${s2.body.id}/start`, { method: 'POST' });
    expect(conflict.status).toBe(409);

    await new Promise((r) => setTimeout(r, 3000));
    expect(comments.length).toBeGreaterThan(5);
    expect(comments[0]).toHaveProperty('phones');
    expect(lastStats.totals.comment).toBeGreaterThan(5);
    expect(lastStats.viewersNow).toBeGreaterThan(0);

    expect((await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' })).status).toBe(200);
    socket.close();

    const stored = await api(`/api/sessions/${sessionId}/stats`);
    expect(stored.body.totals.comment).toBeGreaterThanOrEqual(lastStats.totals.comment);
    expect(stored.body.peakViewers).toBeGreaterThan(0);
    expect(stored.body.uniqueCommenters).toBeGreaterThan(0);

    const dbCount = await db.liveEvent.count({ where: { sessionId, type: 'comment' } });
    expect(dbCount).toBe(stored.body.totals.comment);

    const list = await api(`/api/sessions/${sessionId}/comments?limit=5`);
    expect(list.body.items).toHaveLength(5);
    const phones = await api(`/api/sessions/${sessionId}/comments?phone=1`);
    for (const c of phones.body.items) expect(c.phones.length).toBeGreaterThan(0);

    const xlsx = await api(`/api/sessions/${sessionId}/export.xlsx`);
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as ArrayBuffer).byteLength).toBeGreaterThan(5000);

    const detail = await api(`/api/sessions/${sessionId}`);
    expect(detail.body.status).toBe('ENDED');
  }, 20_000);
});
