import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import type { AdapterCallbacks, AdapterEvent, LiveAdapter } from '../src/core/types.js';
import type { Config } from '../src/config.js';

/** Test tích hợp game show. Cần TEST_DATABASE_URL. */
const url = process.env.TEST_DATABASE_URL;

const scripted = new Map<string, AdapterCallbacks>();
class ScriptedAdapter implements LiveAdapter {
  constructor(private id: string, private cb: AdapterCallbacks) {}
  async start() {
    scripted.set(this.id, this.cb);
    this.cb.onStatus('live');
  }
  async stop() {
    scripted.delete(this.id);
  }
}

describe.skipIf(!url)('Game show', () => {
  let db: PrismaClient;
  let built: BuiltApp;
  let base: string;
  let cookie = '';
  let sessionId = '';
  let channelId = '';
  let publicId = '';

  const api = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), cookie },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: (ct.includes('json') ? await res.json() : await res.arrayBuffer()) as any };
  };
  const pub = () => fetch(`${base}/api/public/s/${publicId}/game`).then((r) => r.json());

  const send = (e: AdapterEvent) => scripted.get(channelId)!.onEvent(e);
  const say = (user: string, content: string, platformTs?: number) =>
    send({ type: 'comment', user: { id: user, name: `Người ${user}`, handle: user }, content, platformTs });
  /** Chờ hàng đợi xử lý bình luận chạy xong */
  const settle = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    await db.shop.deleteMany();
    const config: Config = {
      DATABASE_URL: url!, PORT: 0, HOST: '127.0.0.1', JWT_SECRET: 'test-secret-0123456789',
      ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'matkhau123', FB_GRAPH_VERSION: 'v26.0', NODE_ENV: 'test', WEB_DIST: '/nonexistent',
    };
    built = await buildApp(config, db, { logger: false, adapterFactory: (ch, cb) => new ScriptedAdapter(ch.id, cb), expiryIntervalMs: 60_000_000 });
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(built.app.server.address() as { port: number }).port}`;
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.local', password: 'matkhau123' }),
    });
    cookie = login.headers.get('set-cookie')!.split(';')[0];
    channelId = (await api('/api/channels', { method: 'POST', body: { platform: 'TIKTOK', handle: 'shopgame' } })).body.id;
    sessionId = (await api('/api/sessions', { method: 'POST', body: { title: 'Live game', channelIds: [channelId] } })).body.id;
    publicId = (await api(`/api/sessions/${sessionId}/sales-settings`)).body.publicId;
    await api(`/api/sessions/${sessionId}/start`, { method: 'POST' });
    for (let i = 0; i < 50 && !scripted.has(channelId); i++) await new Promise((r) => setTimeout(r, 20));
  });

  afterAll(async () => {
    await built?.app.close();
    await db?.$disconnect();
  });

  it('kiểm tra cấu hình game', async () => {
    expect((await api(`/api/sessions/${sessionId}/games`, { method: 'POST', body: { type: 'NUMBER_GUESS', title: 'X', config: { min: 50, max: 10 } } })).status).toBe(400);
    expect((await api(`/api/sessions/${sessionId}/games`, { method: 'POST', body: { type: 'WORD_GUESS', title: 'X', config: { answer: '  ' } } })).status).toBe(400);
    expect((await api(`/api/sessions/${sessionId}/games`, { method: 'POST', body: { type: 'QUIZ', title: 'X', config: { answers: [] } } })).status).toBe(400);
  });

  it('đoán số: mỗi người 1 lần, ai đoán trúng sớm nhất (theo thời điểm bình luận) thắng', async () => {
    const g = (await api(`/api/sessions/${sessionId}/games`, {
      method: 'POST',
      body: { type: 'NUMBER_GUESS', title: 'Đoán số may mắn', config: { min: 1, max: 100 }, winnersCount: 2, prizes: ['Voucher 100k', 'Voucher 50k'] },
    })).body;

    say('early', '37'); // trước khi mở game -> không tính
    await settle();
    const opened = await api(`/api/games/${g.id}/open`, { method: 'POST' });
    expect(opened.body.status).toBe('OPEN');
    // Mở game khác khi đang có game mở -> báo lỗi
    const g2 = (await api(`/api/sessions/${sessionId}/games`, { method: 'POST', body: { type: 'QUIZ', title: 'Q', config: { answers: ['x'] } } })).body;
    expect((await api(`/api/games/${g2.id}/open`, { method: 'POST' })).status).toBe(400);

    const t = Date.now();
    say('u1', 'hay quá'); // không có số -> chưa tính lượt
    say('u1', 'em đoán 12');
    say('u1', '37'); // lượt thứ 2 -> bỏ qua
    say('late', '37', t + 3000); // đến trước nhưng bình luận sau
    say('first', 'số 37 nha', t + 1000); // đến sau nhưng bình luận trước
    say('u3', '0912345678'); // số điện thoại không phải số đoán
    say('u4', '37', t + 2000);
    await settle();

    const answers = await db.gameAnswer.findMany({ where: { gameId: g.id } });
    expect(answers.map((a) => [a.platformUserId, a.value]).sort()).toEqual([['first', '37'], ['late', '37'], ['u1', '12'], ['u4', '37']]);

    const spun = await api(`/api/games/${g.id}/spin`, { method: 'POST', body: { result: 37 } });
    expect(spun.body.status).toBe('CLOSED');
    // Đang quay: overlay chưa lộ kết quả
    const during = await pub();
    expect(during.game.status).toBe('SPINNING');
    expect(during.game.result).toBeNull();
    expect(during.game.winners).toEqual([]);

    const done = await built.games.finalize(g.id);
    expect(done.status).toBe('DONE');
    expect(done.winners.map((w) => [w.rank, w.platformUserId, w.prize])).toEqual([
      [1, 'first', 'Voucher 100k'],
      [2, 'u4', 'Voucher 50k'],
    ]);
    const after = await pub();
    expect(after.game.result).toBe('37');
    expect(after.game.winners.map((w: any) => w.name)).toEqual(['Người first', 'Người u4']);

    // Loại người thắng -> người kế tiếp lên
    const dq = await api(`/api/game-winners/${done.winners[0].id}/disqualify`, { method: 'POST' });
    const active = dq.body.winners.filter((w: any) => !w.disqualified);
    expect(active.map((w: any) => [w.rank, w.platformUserId, w.prize])).toEqual([
      [1, 'u4', 'Voucher 100k'],
      [2, 'late', 'Voucher 50k'],
    ]);
    await api(`/api/games/${g2.id}`, { method: 'DELETE' });
  });

  it('đoán chữ: ô chữ không lộ đáp án, đủ người đúng thì tự khoá, xếp theo thời điểm', async () => {
    const g = (await api(`/api/sessions/${sessionId}/games`, {
      method: 'POST',
      body: { type: 'WORD_GUESS', title: 'Đoán chữ', question: 'Con vật hay bắt chuột', config: { answer: 'Con mèo' }, winnersCount: 2, prizes: ['Áo thun'] },
    })).body;
    await api(`/api/games/${g.id}/open`, { method: 'POST' });
    let ov = await pub();
    expect(ov.game.board.map((c: any) => (c.space ? ' ' : c.ch ?? '_')).join('')).toBe('___ ___');
    expect(JSON.stringify(ov).toLowerCase()).not.toMatch(/mèo|meo|con m/);
    expect(ov.game.answerText).toBeNull();

    const r = await api(`/api/games/${g.id}/reveal`, { method: 'POST', body: { index: 0 } });
    expect(r.body.config.revealed).toEqual([0]);
    ov = await pub();
    expect(ov.game.board[0].ch).toBe('C');

    await new Promise((r) => setTimeout(r, 1500));
    const t = Date.now();
    say('w1', 'con chó', t - 900); // sai, hết lượt
    say('w1', 'con mèo', t - 800);
    say('w2', 'CON MEO', t - 400);
    say('w3', 'đáp án là con mèo ạ', t - 200); // đủ 2 người đúng -> tự khoá
    await settle();
    expect((await db.game.findUniqueOrThrow({ where: { id: g.id } })).status).toBe('CLOSED');
    // Đến muộn (Facebook trễ) nhưng bình luận TRƯỚC 2 người kia -> vẫn được tính, xếp đầu
    say('w4', 'conmeo', t - 600);
    // Bình luận SAU lúc khoá -> không tính
    say('w5', 'con mèo', Date.now() + 100);
    await settle();
    expect(await db.gameAnswer.count({ where: { gameId: g.id, platformUserId: 'w5' } })).toBe(0);
    const done = await built.games.finalize(g.id);
    expect(done.winners.map((w) => [w.platformUserId, w.prize])).toEqual([
      ['w4', 'Áo thun'],
      ['w2', 'Áo thun'],
    ]);
    ov = await pub();
    expect(ov.game.answerText).toBe('Con mèo');
    expect(ov.game.board.map((c: any) => c.ch ?? ' ').join('')).toBe('CON MÈO');
  });

  it('quay số may mắn với điều kiện like + follow (TikTok)', async () => {
    const g = (await api(`/api/sessions/${sessionId}/games`, {
      method: 'POST',
      body: { type: 'LUCKY_DRAW', title: 'Quay thưởng', config: { keyword: 'tham gia' }, winnersCount: 5, conditions: { like: true, follow: true } },
    })).body;
    await api(`/api/games/${g.id}/open`, { method: 'POST' });
    for (const u of ['d1', 'd2', 'd3', 'd4']) say(u, 'Tham gia nha');
    say('d5', 'hello'); // không đúng từ khoá
    send({ type: 'like', user: { id: 'd1' }, count: 5 });
    send({ type: 'follow', user: { id: 'd1' } });
    send({ type: 'like', user: { id: 'd2' }, count: 1 }); // chưa follow
    send({ type: 'like', user: { id: 'd3' }, count: 3 });
    send({ type: 'follow', user: { id: 'd3' } });
    await settle();
    await api(`/api/games/${g.id}/draw`, { method: 'POST' });
    const done = await built.games.finalize(g.id);
    expect(done.answersCount).toBe(4);
    expect(done.winners.map((w) => w.platformUserId).sort()).toEqual(['d1', 'd3']);
  });

  it('xuất Excel kết quả game', async () => {
    const x = await api(`/api/sessions/${sessionId}/games/export.xlsx`);
    expect(x.status).toBe(200);
    expect((x.body as ArrayBuffer).byteLength).toBeGreaterThan(5000);
    const list = await api(`/api/sessions/${sessionId}/games`);
    expect(list.body.games).toHaveLength(3);
    await api(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
  });
});
