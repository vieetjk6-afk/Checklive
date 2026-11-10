import type { FastifyInstance, FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { DB } from '../db.js';
import { requireAuth } from '../auth.js';
import { GameError, type GameService } from '../games/gameService.js';

const gameSchema = z.object({
  type: z.enum(['NUMBER_GUESS', 'WORD_GUESS', 'QUIZ', 'LUCKY_DRAW']),
  title: z.string().trim().min(1, 'Nhập tên game').max(120),
  question: z.string().trim().max(500).nullable().optional(),
  config: z
    .object({
      min: z.number().int().optional(),
      max: z.number().int().optional(),
      answer: z.string().max(100).optional(),
      revealed: z.array(z.number().int()).optional(),
      answers: z.array(z.string().max(100)).max(30).optional(),
      keyword: z.string().max(50).optional(),
      accentInsensitive: z.boolean().optional(),
    })
    .default({}),
  winnersCount: z.number().int().min(1).max(100).default(1),
  prizes: z.array(z.string().max(200)).max(100).default([]),
  conditions: z
    .object({
      like: z.boolean().optional(),
      share: z.boolean().optional(),
      follow: z.boolean().optional(),
      facebookPolicy: z.enum(['skip', 'exclude']).optional(),
    })
    .default({}),
  oneAttempt: z.boolean().default(true),
  durationSec: z.number().int().min(5).max(3600).nullable().optional(),
});

const TYPE_LABEL: Record<string, string> = { NUMBER_GUESS: 'Đoán số', WORD_GUESS: 'Đoán chữ', QUIZ: 'Đố vui', LUCKY_DRAW: 'Quay số may mắn' };
const PLATFORM_LABEL: Record<string, string> = { TIKTOK: 'TikTok', FACEBOOK: 'Facebook', SIMULATOR: 'Giả lập' };
const fmt = (d: Date | null) => (d ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof GameError) return reply.code(e.status).send({ error: e.message });
  throw e;
}

export function gameRoutes(app: FastifyInstance, db: DB, games: GameService) {
  app.addHook('preHandler', requireAuth);

  const ownSession = (id: string, shopId: string) => db.liveSession.findFirst({ where: { id, shopId }, select: { id: true, title: true, overlayGameId: true } });

  app.get('/api/sessions/:id/games', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await ownSession(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    return { overlayGameId: s.overlayGameId, games: await games.list(id) };
  });

  app.post('/api/sessions/:id/games', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownSession(id, req.user.shopId))) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const parsed = gameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    try {
      return await games.create(id, parsed.data);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.put('/api/games/:gid', async (req, reply) => {
    const { gid } = req.params as { gid: string };
    const parsed = gameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    try {
      return await games.update(gid, req.user.shopId, parsed.data);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete('/api/games/:gid', async (req, reply) => {
    const { gid } = req.params as { gid: string };
    try {
      await games.remove(gid, req.user.shopId);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/games/:gid/:action', async (req, reply) => {
    const { gid, action } = req.params as { gid: string; action: string };
    const body = (req.body ?? {}) as { result?: number; index?: number };
    try {
      switch (action) {
        case 'open':
          return await games.open(gid, req.user.shopId);
        case 'close':
          return await games.close(gid, req.user.shopId);
        case 'spin':
          return await games.spin(gid, req.user.shopId, typeof body.result === 'number' ? body.result : undefined);
        case 'draw':
          return await games.draw(gid, req.user.shopId);
        case 'reveal':
          return await games.reveal(gid, req.user.shopId, typeof body.index === 'number' ? body.index : undefined);
        case 'finalize': {
          const g = await games.findForShop(gid, req.user.shopId);
          if (g.status === 'OPEN') await games.close(gid, req.user.shopId);
          return await games.finalize(gid);
        }
        case 'show': {
          const g = await games.findForShop(gid, req.user.shopId);
          await games.setOverlay(g.sessionId, gid);
          return { ok: true };
        }
        case 'hide': {
          const g = await games.findForShop(gid, req.user.shopId);
          await games.setOverlay(g.sessionId, null);
          return { ok: true };
        }
        default:
          return reply.code(404).send({ error: 'Không có thao tác này' });
      }
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/game-winners/:wid/disqualify', async (req, reply) => {
    const { wid } = req.params as { wid: string };
    try {
      return await games.disqualify(wid, req.user.shopId);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/games/:gid/answers', async (req, reply) => {
    const { gid } = req.params as { gid: string };
    const q = req.query as { correct?: string; limit?: string };
    try {
      await games.findForShop(gid, req.user.shopId);
      return await games.answers(gid, { correctOnly: q.correct === '1', limit: Number(q.limit) || 100 });
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Xuất Excel: người thắng + toàn bộ câu trả lời (để đối chiếu khi có khiếu nại) */
  app.get('/api/sessions/:id/games/export.xlsx', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await ownSession(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const list = await db.game.findMany({
      where: { sessionId: id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { winners: { orderBy: { rank: 'asc' } }, answers: { orderBy: [{ platformTs: 'asc' }, { receivedAt: 'asc' }] } },
    });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Checklive';
    const head = (ws: ExcelJS.Worksheet) => {
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };
    const w1 = wb.addWorksheet('Người thắng');
    w1.columns = [
      { header: 'Game', key: 'game', width: 28 },
      { header: 'Loại', key: 'type', width: 16 },
      { header: 'Kết quả / đáp án', key: 'result', width: 18 },
      { header: 'Hạng', key: 'rank', width: 7 },
      { header: 'Tên', key: 'name', width: 24 },
      { header: 'Username', key: 'handle', width: 20 },
      { header: 'Nền tảng', key: 'platform', width: 10 },
      { header: 'Câu trả lời', key: 'answer', width: 30 },
      { header: 'Thời điểm trả lời', key: 'at', width: 22 },
      { header: 'Phần thưởng', key: 'prize', width: 24 },
      { header: 'Ghi chú', key: 'note', width: 14 },
    ];
    const w2 = wb.addWorksheet('Câu trả lời');
    w2.columns = [
      { header: 'Game', key: 'game', width: 28 },
      { header: 'Thời điểm', key: 'at', width: 22 },
      { header: 'Tên', key: 'name', width: 24 },
      { header: 'Username', key: 'handle', width: 20 },
      { header: 'Nền tảng', key: 'platform', width: 10 },
      { header: 'Nội dung', key: 'content', width: 40 },
      { header: 'Giá trị', key: 'value', width: 16 },
      { header: 'Đúng', key: 'correct', width: 8 },
    ];
    for (const g of list) {
      const cfg = (g.config ?? {}) as { answer?: string; answers?: string[] };
      const result = g.type === 'NUMBER_GUESS' ? g.result ?? '' : g.type === 'WORD_GUESS' ? cfg.answer ?? '' : g.type === 'QUIZ' ? (cfg.answers ?? []).join(' / ') : '';
      for (const w of g.winners) {
        w1.addRow({
          game: g.title, type: TYPE_LABEL[g.type], result, rank: w.disqualified ? '' : w.rank, name: w.userName ?? '', handle: w.userHandle ?? '',
          platform: PLATFORM_LABEL[w.platform], answer: w.answer ?? '', at: fmt(w.answeredAt), prize: w.prize ?? '', note: w.disqualified ? 'Bị loại' : '',
        });
      }
      for (const a of g.answers) {
        w2.addRow({
          game: g.title, at: fmt(a.platformTs), name: a.userName ?? '', handle: a.userHandle ?? '', platform: PLATFORM_LABEL[a.platform],
          content: a.content, value: a.value ?? '', correct: a.correct ? '✓' : '',
        });
      }
    }
    head(w1);
    head(w2);
    const safe = s.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 60) || 'phien-live';
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="game-${safe}.xlsx"`);
    return reply.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
}
