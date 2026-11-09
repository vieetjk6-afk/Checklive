import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { requireAuth } from '../auth.js';
import { extractPhones } from '../core/text.js';
import { loadAggregator } from '../live/persistence.js';
import { SessionConflictError, type SessionManager } from '../live/sessionManager.js';
import { buildSessionWorkbook } from '../live/exportXlsx.js';

const sessionInput = z.object({
  title: z.string().trim().min(1, 'Nhập tên phiên live').max(200),
  channelIds: z.array(z.string()).min(1, 'Chọn ít nhất 1 kênh'),
});

export function sessionRoutes(app: FastifyInstance, db: DB, manager: SessionManager) {
  app.addHook('preHandler', requireAuth);

  const findSession = (id: string, shopId: string) =>
    db.liveSession.findFirst({
      where: { id, shopId },
      include: { channels: { include: { channel: { select: { id: true, name: true, platform: true, handle: true, isOwn: true } } } } },
    });

  app.get('/api/sessions', async (req) => {
    const list = await db.liveSession.findMany({
      where: { shopId: req.user.shopId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { channels: { include: { channel: { select: { id: true, name: true, platform: true } } } } },
    });
    return list.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      peakViewers: s.peakViewers,
      createdAt: s.createdAt,
      channels: s.channels.map((c) => c.channel),
    }));
  });

  app.post('/api/sessions', async (req, reply) => {
    const parsed = sessionInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const channels = await db.channel.findMany({ where: { id: { in: parsed.data.channelIds }, shopId: req.user.shopId } });
    if (channels.length !== parsed.data.channelIds.length) return reply.code(400).send({ error: 'Kênh không hợp lệ' });
    const shop = await db.shop.findUniqueOrThrow({ where: { id: req.user.shopId }, select: { defaultHoldMinutes: true } });
    const s = await db.liveSession.create({
      data: {
        shopId: req.user.shopId,
        title: parsed.data.title,
        holdMinutes: shop.defaultHoldMinutes,
        channels: { create: channels.map((c) => ({ channelId: c.id })) },
      },
    });
    return { id: s.id };
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await findSession(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    return {
      id: s.id,
      title: s.title,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      peakViewers: s.peakViewers,
      createdAt: s.createdAt,
      publicId: s.publicId,
      channels: s.channels.map((c) => ({ ...c.channel, externalLiveId: c.externalLiveId, peakViewers: c.peakViewers })),
      channelStates: manager.channelStates(s.id) ?? [],
    };
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await findSession(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const parsed = sessionInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    if (parsed.data.channelIds) {
      if (s.status !== 'DRAFT') return reply.code(409).send({ error: 'Chỉ đổi kênh khi phiên chưa bắt đầu' });
      const channels = await db.channel.findMany({ where: { id: { in: parsed.data.channelIds }, shopId: req.user.shopId } });
      if (channels.length !== parsed.data.channelIds.length) return reply.code(400).send({ error: 'Kênh không hợp lệ' });
      await db.sessionChannel.deleteMany({ where: { sessionId: id } });
      await db.sessionChannel.createMany({ data: channels.map((c) => ({ sessionId: id, channelId: c.id })) });
    }
    if (parsed.data.title) await db.liveSession.update({ where: { id }, data: { title: parsed.data.title } });
    return { ok: true };
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await findSession(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    if (manager.isRunning(id)) return reply.code(409).send({ error: 'Hãy kết thúc phiên trước khi xoá' });
    await db.liveSession.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/api/sessions/:id/start', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await findSession(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    try {
      await manager.start(id);
    } catch (e: any) {
      if (e instanceof SessionConflictError) return reply.code(409).send({ error: e.message });
      throw e;
    }
    return { ok: true };
  });

  app.post('/api/sessions/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await findSession(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    await manager.stop(id);
    return { ok: true };
  });

  /** Thống kê: phiên đang chạy lấy từ bộ nhớ, phiên đã xong dựng lại từ CSDL */
  app.get('/api/sessions/:id/stats', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await db.liveSession.findFirst({ where: { id, shopId: req.user.shopId }, select: { id: true } });
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    return manager.snapshot(id) ?? (await loadAggregator(db, id)).snapshot();
  });

  /** Danh sách bình luận đã lưu (phân trang ngược, mới nhất trước) */
  app.get('/api/sessions/:id/comments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z
      .object({
        before: z.coerce.bigint().optional(),
        limit: z.coerce.number().min(1).max(500).default(200),
        platform: z.enum(['TIKTOK', 'FACEBOOK', 'SIMULATOR']).optional(),
        search: z.string().optional(),
        phone: z.enum(['1', '0']).optional(),
      })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Tham số không hợp lệ' });
    const s = await db.liveSession.findFirst({ where: { id, shopId: req.user.shopId }, select: { id: true } });
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });

    const where: Prisma.LiveEventWhereInput = { sessionId: id, type: 'comment' };
    if (q.data.before) where.id = { lt: q.data.before };
    if (q.data.platform) where.platform = q.data.platform;
    if (q.data.search) {
      where.OR = [
        { content: { contains: q.data.search, mode: 'insensitive' } },
        { userName: { contains: q.data.search, mode: 'insensitive' } },
        { userHandle: { contains: q.data.search, mode: 'insensitive' } },
      ];
    }
    // Lọc SĐT: lọc thô bằng SQL (có chuỗi số dài) rồi lọc chính xác bằng hàm extractPhones
    const phoneOnly = q.data.phone === '1';
    const rows = await db.liveEvent.findMany({
      where,
      orderBy: { id: 'desc' },
      take: phoneOnly ? q.data.limit * 5 : q.data.limit,
    });
    const items = rows
      .map((r) => ({
        id: r.id.toString(),
        key: `db-${r.id}`,
        channelId: r.channelId,
        platform: r.platform,
        user: r.platformUserId
          ? { id: r.platformUserId, name: r.userName ?? undefined, handle: r.userHandle ?? undefined, avatarUrl: r.avatarUrl ?? undefined }
          : undefined,
        content: r.content ?? '',
        phones: extractPhones(r.content ?? ''),
        platformTs: r.platformTs.getTime(),
        receivedAt: r.receivedAt.getTime(),
        tag: r.tag ?? undefined,
        tagKind: r.tagKind ?? undefined,
      }))
      .filter((c) => !phoneOnly || c.phones.length > 0)
      .slice(0, q.data.limit);
    const last = rows[rows.length - 1];
    return { items, nextBefore: rows.length > 0 && rows.length >= (phoneOnly ? q.data.limit * 5 : q.data.limit) ? last.id.toString() : null };
  });

  app.get('/api/sessions/:id/export.xlsx', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await findSession(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const buf = await buildSessionWorkbook(db, s, manager.snapshot(id));
    const safe = s.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 60) || 'phien-live';
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="checklive-${safe}.xlsx"`);
    return reply.send(buf);
  });
}
