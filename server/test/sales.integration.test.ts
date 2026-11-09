import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import type { AdapterCallbacks, AdapterEvent, LiveAdapter } from '../src/core/types.js';
import type { Config } from '../src/config.js';

/**
 * Test tích hợp phần bán hàng với CSDL thật. Cần TEST_DATABASE_URL.
 */
const url = process.env.TEST_DATABASE_URL;

/** Kênh "kịch bản": test tự bơm bình luận vào */
const scripted = new Map<string, AdapterCallbacks>();
class ScriptedAdapter implements LiveAdapter {
  constructor(private id: string, private cb: AdapterCallbacks) {}
  async start() {
    scripted.set(this.id, this.cb);
    this.cb.onStatus('live');
  }
  async stop() {
    scripted.delete(this.id);
    this.cb.onStatus('stopped');
  }
}

describe.skipIf(!url)('Bán hàng: chốt đơn từ bình luận', () => {
  let db: PrismaClient;
  let built: BuiltApp;
  let base: string;
  let cookie = '';
  let sessionId = '';
  let channelId = '';
  let publicId = '';
  let ao: any; // sản phẩm áo có phân loại
  let quan: any; // sản phẩm quần không phân loại
  let spA1 = '';
  let spA2 = '';

  const api = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), cookie },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: (ct.includes('json') ? await res.json() : await res.arrayBuffer()) as any };
  };

  const comment = (user: string, content: string, platform: AdapterEvent['type'] = 'comment') =>
    scripted.get(channelId)!.onEvent({ type: platform, user: { id: user, name: `Khách ${user}`, handle: user }, content });

  const waitFor = async (fn: () => Promise<boolean>, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('Hết thời gian chờ');
  };

  const orderOf = (user: string) =>
    db.order.findFirst({ where: { sessionId, platformUserId: user }, include: { items: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' } });

  const variantOf = (product: any, label: string) => product.variants.find((v: any) => v.label === label);

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    await db.shop.deleteMany();
    const config: Config = {
      DATABASE_URL: url!, PORT: 0, HOST: '127.0.0.1', JWT_SECRET: 'test-secret-0123456789',
      ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'matkhau123', FB_GRAPH_VERSION: 'v26.0',
      NODE_ENV: 'test', WEB_DIST: '/nonexistent',
    };
    built = await buildApp(config, db, {
      logger: false,
      adapterFactory: (ch, cb) => new ScriptedAdapter(ch.id, cb),
      expiryIntervalMs: 60_000_000,
    });
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.local', password: 'matkhau123' }),
    });
    cookie = login.headers.get('set-cookie')!.split(';')[0];
  });

  afterAll(async () => {
    await built?.app.close();
    await db?.$disconnect();
  });

  it('tạo sản phẩm có phân loại, kiểm tra dữ liệu sai', async () => {
    const bad = await api('/api/products', {
      method: 'POST',
      body: { name: 'Áo', price: 100000, attributes: [{ name: 'Màu', values: ['Đỏ'] }], variants: [{ options: { 'Màu': 'Tím' }, stock: 1 }] },
    });
    expect(bad.status).toBe(400);

    const r = await api('/api/products', {
      method: 'POST',
      body: {
        name: 'Áo thun', price: 150000,
        attributes: [{ name: 'Màu', values: ['Đỏ', 'Trắng'] }, { name: 'Size', values: ['M', 'L'] }],
        variants: [
          { options: { 'Màu': 'Đỏ', Size: 'M' }, stock: 2 },
          { options: { 'Màu': 'Đỏ', Size: 'L' }, stock: 5 },
          { options: { 'Màu': 'Trắng', Size: 'M' }, stock: 5 },
          { options: { 'Màu': 'Trắng', Size: 'L' }, stock: 0 },
        ],
      },
    });
    expect(r.status).toBe(200);
    ao = r.body;
    expect(ao.variants.map((v: any) => v.label)).toEqual(['Đỏ / M', 'Đỏ / L', 'Trắng / M', 'Trắng / L']);

    const q = await api('/api/products', { method: 'POST', body: { name: 'Quần jean', price: 300000, attributes: [], variants: [{ options: {}, stock: 5 }] } });
    quan = q.body;
  });

  it('tạo phiên, gắn sản phẩm với mã live, mở bán', async () => {
    channelId = (await api('/api/channels', { method: 'POST', body: { platform: 'TIKTOK', handle: 'shopabc' } })).body.id;
    sessionId = (await api('/api/sessions', { method: 'POST', body: { title: 'Live test bán hàng', channelIds: [channelId] } })).body.id;

    const a1 = await api(`/api/sessions/${sessionId}/products`, { method: 'POST', body: { productId: ao.id, livePrice: 99000 } });
    expect(a1.body.code).toBe('A1');
    spA1 = a1.body.id;
    const a2 = await api(`/api/sessions/${sessionId}/products`, { method: 'POST', body: { productId: quan.id, code: 'a2', perCustomerLimit: 2 } });
    expect(a2.body.code).toBe('A2');
    spA2 = a2.body.id;
    expect((await api(`/api/sessions/${sessionId}/products`, { method: 'POST', body: { productId: quan.id, code: 'A2' } })).status).toBe(409);
    expect((await api(`/api/sessions/${sessionId}/products`, { method: 'POST', body: { productId: quan.id, code: 'A 3' } })).status).toBe(400);

    expect((await api(`/api/sessions/${sessionId}/products/${spA1}`, { method: 'PATCH', body: { status: 'SELLING' } })).status).toBe(200);
    const settings = await api(`/api/sessions/${sessionId}/sales-settings`);
    expect(settings.body).toMatchObject({ holdMinutes: 1440, orderMode: 'ALL_CODES' });
    publicId = settings.body.publicId;

    expect((await api(`/api/sessions/${sessionId}/start`, { method: 'POST' })).status).toBe(200);
    await waitFor(async () => scripted.has(channelId));
  });

  it('bình luận có mã -> giữ hàng; hết hàng -> danh sách chờ; ghi chú vào bình luận', async () => {
    comment('u1', 'A1 đỏ M 2');
    comment('u2', 'chốt đỏ M'); // từ khoá chốt -> sản phẩm đang bán A1
    comment('u3', 'A1 trắng L'); // tồn kho 0
    comment('u4', 'A1 còn đỏ M không shop?'); // câu hỏi
    await waitFor(async () => (await db.order.count({ where: { sessionId } })) === 3);

    const o1 = await orderOf('u1');
    expect(o1!.items.map((i) => [i.status, i.quantity, i.unitPrice])).toEqual([['RESERVED', 2, 99000]]);
    expect(o1!.total).toBe(198000);
    expect(o1!.holdUntil).not.toBeNull();
    const o2 = await orderOf('u2');
    expect(o2!.items.map((i) => [i.status, i.quantity])).toEqual([['WAITLIST', 1]]);
    expect(o2!.holdUntil).toBeNull(); // chưa có hàng thì chưa tính giờ giữ
    expect((await orderOf('u3'))!.items[0].status).toBe('WAITLIST');
    expect(await orderOf('u4')).toBeNull();

    const v = await db.productVariant.findUniqueOrThrow({ where: { id: variantOf(ao, 'Đỏ / M').id } });
    expect(v.reserved).toBe(2);

    // Kết quả xử lý được lưu kèm bình luận
    await waitFor(async () => (await db.liveEvent.count({ where: { sessionId, type: 'comment', tag: { not: null } } })) >= 4);
    const tags = await db.liveEvent.findMany({ where: { sessionId, type: 'comment' }, orderBy: { id: 'asc' }, select: { content: true, tag: true, tagKind: true } });
    expect(tags[0].tagKind).toBe('order');
    expect(tags[0].tag).toContain(o1!.code);
    expect(tags[1].tagKind).toBe('waitlist');
    expect(tags[3].tagKind).toBe('question');
  });

  it('gộp nhiều bình luận của cùng khách vào 1 đơn; giới hạn mỗi khách', async () => {
    comment('u1', 'A2');
    comment('u1', 'A2 x3'); // giới hạn 2/khách -> chỉ nhận thêm 1
    comment('u1', 'A2'); // vượt giới hạn
    await waitFor(async () => (await orderOf('u1'))!.items.length >= 2);
    await new Promise((r) => setTimeout(r, 300));
    const o1 = await orderOf('u1');
    expect(await db.order.count({ where: { sessionId, platformUserId: 'u1' } })).toBe(1);
    const a2 = o1!.items.filter((i) => i.sessionProductId === spA2);
    expect(a2.reduce((s, i) => s + i.quantity, 0)).toBe(2);
    expect(o1!.total).toBe(198000 + 2 * 300000);
  });

  it('huỷ đơn -> nhả hàng -> người chờ đầu tiên được giữ hàng', async () => {
    const o1 = await orderOf('u1');
    const r = await api(`/api/orders/${o1!.id}/cancel`, { method: 'POST', body: { reason: 'Khách đổi ý' } });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('CANCELLED');
    const o2 = await orderOf('u2');
    expect(o2!.items[0].status).toBe('RESERVED');
    expect(o2!.holdUntil).not.toBeNull();
    const v = await db.productVariant.findUniqueOrThrow({ where: { id: variantOf(ao, 'Đỏ / M').id } });
    expect(v.reserved).toBe(1);
  });

  it('tăng tồn kho -> người chờ được giữ hàng', async () => {
    const vars = ao.variants.map((v: any) => ({ id: v.id, options: v.options, stock: v.label === 'Trắng / L' ? 3 : v.stock }));
    const r = await api(`/api/products/${ao.id}`, { method: 'PUT', body: { name: ao.name, price: ao.price, attributes: ao.attributes, variants: vars } });
    expect(r.status).toBe(200);
    expect((await orderOf('u3'))!.items[0].status).toBe('RESERVED');
  });

  it('chưa rõ phân loại -> nhân viên chọn phân loại -> giữ hàng', async () => {
    comment('u5', 'A1 trắng');
    await waitFor(async () => !!(await orderOf('u5')));
    const o5 = await orderOf('u5');
    expect(o5!.items[0].status).toBe('NEEDS_VARIANT');
    const r = await api(`/api/orders/${o5!.id}/items/${o5!.items[0].id}`, { method: 'PATCH', body: { variantId: variantOf(ao, 'Trắng / M').id } });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: any) => [i.status, i.variantLabel])).toEqual([['RESERVED', 'Trắng / M']]);
  });

  it('20 người chốt cùng lúc khi chỉ còn 5 cái: không bán quá tồn kho', async () => {
    const vid = variantOf(ao, 'Đỏ / L').id;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        built.sales.addLines(sessionId, { platform: 'TIKTOK', platformUserId: `race${i}`, name: `Race ${i}` }, [{ sessionProductId: spA1, variantId: vid, quantity: 1 }]),
      ),
    );
    const reserved = results.reduce((s, r) => s + r.results[0].reserved, 0);
    const waiting = results.reduce((s, r) => s + r.results[0].waitlisted, 0);
    expect(reserved).toBe(5);
    expect(waiting).toBe(15);
    const v = await db.productVariant.findUniqueOrThrow({ where: { id: vid } });
    expect(v.reserved).toBe(5);
    expect(v.stock).toBe(5);
  });

  it('hết hạn giữ hàng -> huỷ đơn, nhả hàng cho người chờ', async () => {
    const vid = variantOf(ao, 'Đỏ / L').id;
    const first = await db.order.findFirst({ where: { sessionId, platformUserId: { startsWith: 'race' }, items: { some: { status: 'RESERVED', variantId: vid } } } });
    await db.order.update({ where: { id: first!.id }, data: { holdUntil: new Date(Date.now() - 1000) } });
    const n = await built.sales.expireDue();
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe('EXPIRED');
    const v = await db.productVariant.findUniqueOrThrow({ where: { id: vid } });
    expect(v.reserved).toBe(5); // 1 người chờ đã được chuyển lên
    expect(await db.orderItem.count({ where: { variantId: vid, status: 'RESERVED', order: { status: 'PENDING' } } })).toBe(5);
  });

  it('khách tra cứu đơn và tự xác nhận (trang công khai)', async () => {
    const pub = await fetch(`${base}/api/public/s/${publicId}`).then((r) => r.json());
    expect(pub.products.map((p: any) => p.code)).toEqual(['A1', 'A2']);

    comment('u6', 'A1 đỏ'); // chưa rõ size
    await waitFor(async () => !!(await orderOf('u6')));
    const found = await fetch(`${base}/api/public/s/${publicId}/lookup?q=@U6`).then((r) => r.json());
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Khách U.');
    const token = found[0].token;

    const view = await fetch(`${base}/api/public/o/${token}`).then((r) => r.json());
    expect(view.items[0].status).toBe('NEEDS_VARIANT');
    expect(view.items[0].variants.map((v: any) => v.label)).toContain('Đỏ / L');

    const post = (body: unknown) =>
      fetch(`${base}/api/public/o/${token}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post({ receiverName: 'Lan', receiverPhone: '123', receiverAddress: '12 Láng Hạ, Đống Đa, Hà Nội', paymentMethod: 'COD' })).status).toBe(400);

    const ok = await post({
      receiverName: 'Nguyễn Thị Lan', receiverPhone: '0912 345 678', receiverAddress: '12 Láng Hạ, Đống Đa, Hà Nội', paymentMethod: 'BANK',
      variantChoices: { [view.items[0].id]: variantOf(ao, 'Trắng / M').id },
    });
    expect(ok.status).toBe(200);
    const o6 = await orderOf('u6');
    expect(o6!.status).toBe('CONFIRMED');
    expect(o6!.receiverPhone).toBe('0912345678');
    expect(o6!.holdUntil).toBeNull();
    expect(o6!.items.map((i) => [i.status, i.variantLabel])).toEqual([['RESERVED', 'Trắng / M']]);
    const customer = await db.customer.findUniqueOrThrow({ where: { id: o6!.customerId! } });
    expect(customer.address).toBe('12 Láng Hạ, Đống Đa, Hà Nội');

    // Thông tin cá nhân trả ra trang công khai đã được che
    const again = await fetch(`${base}/api/public/o/${token}`).then((r) => r.json());
    expect(again.receiver.phone).toBe('0912***678');
    expect(JSON.stringify(again)).not.toContain('Láng Hạ');

    // Chưa cài ngân hàng -> không có QR
    expect((await fetch(`${base}/api/public/o/${token}/payment`)).status).toBe(400);
    await api('/api/shop', { method: 'PUT', body: { name: 'Shop ABC', bankBin: '970436', bankAccountNo: '0123456789', bankAccountName: 'Nguyen Van A', defaultHoldMinutes: 60 } });
    const pay = await fetch(`${base}/api/public/o/${token}/payment`).then((r) => r.json());
    expect(pay.amount).toBe(99000);
    expect(pay.payload).toContain(`5405${'99000'}`);
    expect(pay.note).toBe(o6!.code);
  });

  it('nhân viên chốt và hoàn tất đơn -> trừ tồn kho thực tế', async () => {
    const o6 = await orderOf('u6');
    const vid = o6!.items[0].variantId!;
    const before = await db.productVariant.findUniqueOrThrow({ where: { id: vid } });
    expect((await api(`/api/orders/${o6!.id}/complete`, { method: 'POST' })).status).toBe(400); // phải chốt trước
    expect((await api(`/api/orders/${o6!.id}/approve`, { method: 'POST' })).body.status).toBe('APPROVED');
    expect((await api(`/api/orders/${o6!.id}/complete`, { method: 'POST' })).body.status).toBe('COMPLETED');
    const after = await db.productVariant.findUniqueOrThrow({ where: { id: vid } });
    expect(after.stock).toBe(before.stock - 1);
    expect(after.reserved).toBe(before.reserved - 1);
    expect((await api(`/api/orders/${o6!.id}/cancel`, { method: 'POST' })).status).toBe(400);
  });

  it('mã đã đóng không nhận đơn; xuất Excel đơn hàng', async () => {
    await api(`/api/sessions/${sessionId}/products/${spA2}`, { method: 'PATCH', body: { status: 'CLOSED' } });
    comment('u7', 'A2');
    await waitFor(async () => (await db.liveEvent.count({ where: { sessionId, content: 'A2', tagKind: 'warn' } })) > 0);
    expect(await orderOf('u7')).toBeNull();

    const x = await api(`/api/sessions/${sessionId}/orders/export.xlsx`);
    expect(x.status).toBe(200);
    expect((x.body as ArrayBuffer).byteLength).toBeGreaterThan(5000);

    const list = await api(`/api/sessions/${sessionId}/products`);
    const a1 = list.body.find((p: any) => p.code === 'A1');
    expect(a1.orderedQty).toBeGreaterThan(0);
    expect(a1.waitlistQty).toBeGreaterThan(0);
    await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
  });
});
