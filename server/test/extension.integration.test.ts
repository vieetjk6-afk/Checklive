import { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { cleanText, mapExtComment } from '../src/adapters/extension.js';
import type { Config } from '../src/config.js';
import { SimulatorAdapter } from '../src/adapters/simulator.js';
import path from 'node:path';

const url = process.env.TEST_DATABASE_URL;

describe('chuyển bình luận từ tiện ích', () => {
  it('bỏ "Xem thêm", dùng ID người dùng hoặc tên', () => {
    expect(cleanText('Mình lấy A1… Xem thêm')).toBe('Mình lấy A1');
    const now = Date.now();
    const e = mapExtComment({ id: 'c1', author: { name: 'Lan', id: '100' }, text: 'A1', ts: now - 1000 }, now)!;
    expect(e).toMatchObject({ type: 'comment', externalId: 'fb:c1', user: { id: '100', name: 'Lan' }, content: 'A1', platformTs: now - 1000 });
    expect(mapExtComment({ author: { name: 'Mai' }, text: 'chốt' }, now)!.user!.id).toBe('name:Mai');
    // Thời điểm ở tương lai (đồng hồ máy lệch) -> dùng giờ server
    expect(mapExtComment({ author: { name: 'Mai' }, text: 'x', ts: now + 60_000 }, now)!.platformTs).toBe(now);
    expect(mapExtComment({ author: { name: '' }, text: 'x' }, now)).toBeUndefined();
  });
});

describe.skipIf(!url)('API cho tiện ích Chrome', () => {
  let db: PrismaClient;
  let built: BuiltApp;
  let base: string;
  let cookie = '';
  let token = '';
  let channelId = '';
  let sessionId = '';

  const api = async (p: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + p, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), cookie, ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, headers: res.headers, body: (ct.includes('json') ? await res.json() : await res.arrayBuffer()) as any };
  };
  const ext = (p: string, body?: unknown, tk = token) =>
    api(p, { method: body === undefined ? 'GET' : 'POST', body, headers: { authorization: `Bearer ${tk}`, cookie: '' } });

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    await db.shop.deleteMany();
    const config: Config = {
      DATABASE_URL: url!, PORT: 0, HOST: '127.0.0.1', JWT_SECRET: 'test-secret-0123456789', ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'matkhau123', FB_GRAPH_VERSION: 'v26.0', NODE_ENV: 'test', WEB_DIST: '/nonexistent',
      EXTENSION_DIR: path.resolve(__dirname, '../../extension'),
    };
    built = await buildApp(config, db, { logger: false, adapterFactory: (ch, cb) => new SimulatorAdapter(cb, { eventsPerSecond: 0.01 }), expiryIntervalMs: 60_000_000 });
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.local', password: 'matkhau123' }),
    });
    cookie = login.headers.get('set-cookie')!.split(';')[0];
  });

  afterAll(async () => {
    await built?.app.close();
    await db?.$disconnect();
  });

  it('tạo kênh Facebook qua tiện ích: có mã kết nối, không cần Page token', async () => {
    expect((await api('/api/channels', { method: 'POST', body: { platform: 'TIKTOK', handle: 'abc', connector: 'EXTENSION' } })).status).toBe(400);
    const r = await api('/api/channels', {
      method: 'POST',
      body: { platform: 'FACEBOOK', handle: 'https://www.facebook.com/nguyen.lan.anh', connector: 'EXTENSION', isOwn: true },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connector: 'EXTENSION', name: 'Facebook nguyen.lan.anh', hasAccessToken: false });
    expect(r.body.connectorToken).toMatch(/^clx_/);
    token = r.body.connectorToken;
    channelId = r.body.id;
  });

  it('xác thực bằng mã kết nối, cho phép gọi từ tiện ích (CORS)', async () => {
    const pre = await fetch(base + '/api/ext/events', { method: 'OPTIONS', headers: { origin: 'chrome-extension://abc', 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect((await ext('/api/ext/whoami', undefined, 'sai')).status).toBe(401);
    const who = await ext('/api/ext/whoami');
    expect(who.body).toMatchObject({ channel: { id: channelId }, running: false, sessionTitle: null });
  });

  it('kênh chưa nằm trong phiên đang chạy: báo cho tiện ích biết', async () => {
    const r = await ext('/api/ext/events', { comments: [{ author: { name: 'Lan' }, text: 'A1' }] });
    expect(r.body).toMatchObject({ ok: true, running: false, accepted: 0 });
    expect(r.body.message).toContain('Bắt đầu theo dõi');
  });

  it('nhận bình luận vào phiên: thống kê, chốt đơn, chống trùng, số người xem', async () => {
    const product = (await api('/api/products', { method: 'POST', body: { name: 'Áo', price: 100000, attributes: [], variants: [{ options: {}, stock: 10 }] } })).body;
    sessionId = (await api('/api/sessions', { method: 'POST', body: { title: 'Live FB cá nhân', channelIds: [channelId] } })).body.id;
    await api(`/api/sessions/${sessionId}/products`, { method: 'POST', body: { productId: product.id } });
    await api(`/api/sessions/${sessionId}/start`, { method: 'POST' });

    let detail = await api(`/api/sessions/${sessionId}`);
    expect(detail.body.channelStates[0]).toMatchObject({ status: 'waiting' });

    const batch = {
      pageUrl: 'https://www.facebook.com/nguyen.lan.anh/videos/123',
      pageTitle: 'Lan Anh đang phát trực tiếp',
      viewers: 345,
      comments: [
        { id: 'c1', author: { name: 'Nguyễn Thu Hà', id: '100011112222', avatar: 'https://scontent.xx.fbcdn.net/a.jpg' }, text: 'A1 2 cái', ts: Date.now() - 500 },
        { id: 'c2', author: { name: 'Trần Mai', id: 'tran.mai' }, text: 'đẹp quá', ts: Date.now() - 300 },
      ],
    };
    const r = await ext('/api/ext/events', batch);
    expect(r.body).toMatchObject({ ok: true, running: true, accepted: 2, sessionTitle: 'Live FB cá nhân' });
    // Gửi lại cùng lô (tiện ích gửi lại khi mạng chập chờn) -> không bị trùng
    await ext('/api/ext/events', batch);
    // Nhịp giữ kết nối (không có bình luận)
    await ext('/api/ext/events', { viewers: 360 });

    await new Promise((res) => setTimeout(res, 1500));
    detail = await api(`/api/sessions/${sessionId}`);
    expect(detail.body.channelStates[0]).toMatchObject({ status: 'live', externalLiveId: batch.pageUrl });
    const stats = await api(`/api/sessions/${sessionId}/stats`);
    expect(stats.body.totals.comment).toBe(2);
    expect(stats.body.viewersNow).toBe(360);
    expect(stats.body.peakViewers).toBe(360);
    const orders = await api(`/api/sessions/${sessionId}/orders`);
    expect(orders.body).toHaveLength(1);
    expect(orders.body[0]).toMatchObject({ platform: 'FACEBOOK', platformUserId: '100011112222', displayName: 'Nguyễn Thu Hà', total: 200000 });

    expect((await ext('/api/ext/whoami')).body.running).toBe(true);
  });

  it('đổi mã kết nối: mã cũ hết hiệu lực', async () => {
    const r = await api(`/api/channels/${channelId}/token`, { method: 'POST' });
    expect(r.body.connectorToken).not.toBe(token);
    expect((await ext('/api/ext/whoami')).status).toBe(401);
    token = r.body.connectorToken;
    expect((await ext('/api/ext/whoami')).status).toBe(200);
  });

  it('tải tiện ích .zip có sẵn địa chỉ server', async () => {
    const res = await fetch(base + '/downloads/checklive-connector.zip');
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names).toContain('checklive-connector/manifest.json');
    expect(names).toContain('checklive-connector/fb-extract.js');
    expect(names.some((n) => n.includes('/test/'))).toBe(false);
    const cfg = await zip.file('checklive-connector/config.js')!.async('string');
    expect(cfg).toContain(JSON.stringify(base));
    await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
  });
});
