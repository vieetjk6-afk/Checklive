import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { requireAuth } from '../auth.js';
import { checkFacebookPage } from '../adapters/facebook.js';
import { checkTikTokUser } from '../adapters/tiktok.js';

const channelInput = z.object({
  platform: z.enum(['TIKTOK', 'FACEBOOK', 'SIMULATOR']),
  name: z.string().trim().max(100).optional(),
  handle: z.string().trim().min(1, 'Thiếu username / Page ID').max(200),
  accessToken: z.string().trim().optional(),
  isOwn: z.boolean().default(true),
});

/** Chuẩn hoá: TikTok bỏ @ và phần link thừa */
export function normalizeHandle(platform: string, handle: string): string {
  let h = handle.trim();
  if (platform === 'TIKTOK') {
    const m = h.match(/tiktok\.com\/@([^/?#]+)/i);
    if (m) h = m[1];
    h = h.replace(/^@/, '').toLowerCase();
  }
  return h;
}

/** Không trả token ra giao diện, chỉ báo đã có hay chưa */
function publicChannel(c: { accessToken: string | null } & Record<string, unknown>) {
  const { accessToken, ...rest } = c;
  return { ...rest, hasAccessToken: !!accessToken };
}

export function channelRoutes(app: FastifyInstance, db: DB, config: Config) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/channels', async (req) => {
    const list = await db.channel.findMany({ where: { shopId: req.user.shopId }, orderBy: { createdAt: 'asc' } });
    return list.map(publicChannel);
  });

  app.post('/api/channels', async (req, reply) => {
    const parsed = channelInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const input = parsed.data;
    const handle = normalizeHandle(input.platform, input.handle);
    if (input.platform === 'FACEBOOK' && !input.accessToken) {
      return reply.code(400).send({ error: 'Fanpage cần Page access token' });
    }
    const exists = await db.channel.findFirst({ where: { shopId: req.user.shopId, platform: input.platform, handle } });
    if (exists) return reply.code(409).send({ error: 'Kênh này đã có trong danh sách' });
    const defaultName = input.platform === 'TIKTOK' ? `@${handle}` : input.platform === 'SIMULATOR' ? `Giả lập ${handle}` : `Fanpage ${handle}`;
    const ch = await db.channel.create({
      data: {
        shopId: req.user.shopId,
        platform: input.platform,
        handle,
        name: input.name || defaultName,
        accessToken: input.accessToken || null,
        isOwn: input.isOwn,
      },
    });
    return publicChannel(ch);
  });

  app.patch('/api/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ name: z.string().trim().min(1).max(100).optional(), accessToken: z.string().trim().optional(), isOwn: z.boolean().optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Dữ liệu không hợp lệ' });
    const ch = await db.channel.findFirst({ where: { id, shopId: req.user.shopId } });
    if (!ch) return reply.code(404).send({ error: 'Không tìm thấy kênh' });
    const updated = await db.channel.update({
      where: { id },
      data: {
        name: body.data.name,
        isOwn: body.data.isOwn,
        accessToken: body.data.accessToken ? body.data.accessToken : undefined,
      },
    });
    return publicChannel(updated);
  });

  app.delete('/api/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ch = await db.channel.findFirst({ where: { id, shopId: req.user.shopId } });
    if (!ch) return reply.code(404).send({ error: 'Không tìm thấy kênh' });
    const used = await db.sessionChannel.count({ where: { channelId: id, session: { status: 'RUNNING' } } });
    if (used > 0) return reply.code(409).send({ error: 'Kênh đang dùng trong phiên live đang chạy' });
    await db.channel.delete({ where: { id } });
    return { ok: true };
  });

  /** Kiểm tra kết nối: token Facebook còn dùng được không, kênh có đang live không */
  app.post('/api/channels/:id/check', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ch = await db.channel.findFirst({ where: { id, shopId: req.user.shopId } });
    if (!ch) return reply.code(404).send({ error: 'Không tìm thấy kênh' });
    try {
      if (ch.platform === 'FACEBOOK') {
        const r = await checkFacebookPage(ch.handle, ch.accessToken ?? '', config.FB_GRAPH_VERSION);
        return { ok: true, isLive: r.isLive, message: `Kết nối được Fanpage "${r.name}". ${r.isLive ? 'Đang live.' : 'Chưa live.'}` };
      }
      if (ch.platform === 'TIKTOK') {
        const r = await checkTikTokUser(ch.handle, config.EULER_API_KEY);
        return { ok: true, isLive: r.isLive, message: r.isLive ? `@${ch.handle} đang live.` : `@${ch.handle} chưa live.` };
      }
      return { ok: true, isLive: true, message: 'Kênh giả lập luôn sẵn sàng.' };
    } catch (e: any) {
      return { ok: false, isLive: false, message: `Lỗi: ${e?.message ?? e}` };
    }
  });
}
