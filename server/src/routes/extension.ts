import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import type { ExtensionHub } from '../adapters/extension.js';

const payloadSchema = z.object({
  pageUrl: z.string().max(2000).optional(),
  pageTitle: z.string().max(500).optional(),
  viewers: z.number().nullable().optional(),
  comments: z
    .array(
      z.object({
        id: z.string().max(500).optional(),
        author: z.object({
          name: z.string().max(200),
          id: z.string().max(200).optional(),
          url: z.string().max(2000).optional(),
          avatar: z.string().max(2000).optional(),
        }),
        text: z.string().max(5000),
        ts: z.number().optional(),
      }),
    )
    .max(500)
    .optional(),
});

/** Giới hạn số lần gọi mỗi phút theo mã kết nối */
function limiter(max: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + 60_000 });
      return true;
    }
    return ++h.n <= max;
  };
}

/**
 * API cho tiện ích Chrome "Checklive Connector".
 * Xác thực bằng mã kết nối của từng kênh (Authorization: Bearer <mã>), cho phép gọi từ mọi nguồn (CORS)
 * vì yêu cầu đến từ tiện ích chứ không phải từ trình duyệt đã đăng nhập.
 */
export function extensionRoutes(app: FastifyInstance, db: DB, hub: ExtensionHub, extensionDir: string) {
  app.addHook('onRequest', (req, reply, done) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Max-Age', '600');
    done();
  });
  app.options('/api/ext/*', async (_req, reply) => reply.code(204).send());

  const allow = limiter(240);

  const channelOf = async (req: FastifyRequest, reply: FastifyReply) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!m) {
      reply.code(401).send({ error: 'Thiếu mã kết nối' });
      return null;
    }
    if (!allow(m[1])) {
      reply.code(429).send({ error: 'Gửi quá nhiều, thử lại sau' });
      return null;
    }
    const ch = await db.channel.findUnique({ where: { connectorToken: m[1] }, include: { shop: { select: { name: true } } } });
    if (!ch || ch.connector !== 'EXTENSION') {
      reply.code(401).send({ error: 'Mã kết nối không đúng hoặc đã bị đổi' });
      return null;
    }
    return ch;
  };

  const runningSession = (channelId: string) =>
    db.sessionChannel.findFirst({ where: { channelId, session: { status: 'RUNNING' } }, include: { session: { select: { id: true, title: true } } } });

  app.get('/api/ext/whoami', async (req, reply) => {
    const ch = await channelOf(req, reply);
    if (!ch) return;
    const sc = await runningSession(ch.id);
    return {
      channel: { id: ch.id, name: ch.name, handle: ch.handle },
      shopName: ch.shop.name,
      running: !!sc && hub.isActive(ch.id),
      sessionTitle: sc?.session.title ?? null,
    };
  });

  app.post('/api/ext/events', async (req, reply) => {
    const ch = await channelOf(req, reply);
    if (!ch) return;
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dữ liệu không hợp lệ' });
    const accepted = hub.push(ch.id, parsed.data);
    if (accepted === null) {
      return {
        ok: true,
        running: false,
        accepted: 0,
        message: `Kênh "${ch.name}" chưa nằm trong phiên live đang chạy. Vào Checklive, tạo phiên có kênh này và bấm "Bắt đầu theo dõi".`,
      };
    }
    const sc = await runningSession(ch.id);
    return { ok: true, running: true, accepted, sessionTitle: sc?.session.title ?? null };
  });

  /** Tải tiện ích (.zip) đã điền sẵn địa chỉ server này */
  app.get('/downloads/checklive-connector.zip', async (req, reply) => {
    if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) return reply.code(404).send({ error: 'Không tìm thấy thư mục tiện ích' });
    const zip = new JSZip();
    const root = zip.folder('checklive-connector')!;
    const walk = (dir: string, rel = '') => {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.') || name === 'config.js' || name === 'test') continue;
        const full = path.join(dir, name);
        const r = rel ? `${rel}/${name}` : name;
        if (fs.statSync(full).isDirectory()) walk(full, r);
        else root.file(r, fs.readFileSync(full));
      }
    };
    walk(extensionDir);
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol;
    const serverUrl = `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
    root.file('config.js', `// Tạo tự động khi tải tiện ích\nself.CHECKLIVE_DEFAULT_SERVER = ${JSON.stringify(serverUrl)};\n`);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    reply.header('Content-Type', 'application/zip').header('Content-Disposition', 'attachment; filename="checklive-connector.zip"');
    return reply.send(buf);
  });
}
