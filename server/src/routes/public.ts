import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { maskPhone } from '../core/text.js';
import { SalesError, variantLabel, type OrderService } from '../sales/orderService.js';
import { buildVietQrPayload } from '../sales/vietqr.js';
import type { GameService } from '../games/gameService.js';

/**
 * Trang công khai (không cần đăng nhập): tra cứu đơn, khách tự xác nhận, overlay cho OBS.
 * Không trả về thông tin cá nhân đầy đủ; có giới hạn số lần gọi theo IP.
 */

/** Che tên: "Nguyễn Thu Hà" -> "Nguyễn T. H." */
export function maskName(name: string | null | undefined): string {
  if (!name) return 'Khách';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].length <= 2 ? parts[0] : `${parts[0].slice(0, 2)}***`;
  return [parts[0], ...parts.slice(1).map((p) => `${p.charAt(0).toUpperCase()}.`)].join(' ');
}

function maskAddress(addr: string): string {
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length <= 2 ? '***' : `***, ${parts.slice(-2).join(', ')}`;
}

/** Giới hạn đơn giản: tối đa `limit` lần / phút / IP cho mỗi nhóm */
function rateLimiter(limit: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const now = Date.now();
    const key = req.ip;
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + 60_000 });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return done();
    }
    if (++h.n > limit) {
      reply.code(429).send({ error: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút' });
      return;
    }
    done();
  };
}

const confirmSchema = z.object({
  receiverName: z.string().trim().max(100).optional(),
  receiverPhone: z.string().trim().max(20).optional(),
  receiverAddress: z.string().trim().max(500).optional(),
  note: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(['COD', 'BANK']),
  useSaved: z.boolean().optional(),
  variantChoices: z.record(z.string(), z.string()).optional(),
});

export function publicRoutes(app: FastifyInstance, db: DB, sales: OrderService, games?: GameService) {
  const limitRead = rateLimiter(300);
  const limitLookup = rateLimiter(20);
  const limitWrite = rateLimiter(10);

  const findSession = (publicId: string) =>
    db.liveSession.findUnique({ where: { publicId }, include: { shop: { select: { name: true } } } });

  /** Thông tin phiên + danh sách sản phẩm (cho trang tra cứu) */
  app.get('/api/public/s/:publicId', { preHandler: limitRead }, async (req, reply) => {
    const { publicId } = req.params as { publicId: string };
    const s = await findSession(publicId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const products = (await sales.sessionProducts(s.id)).filter((p) => p.status !== 'CLOSED');
    return {
      shopName: s.shop.name,
      title: s.title,
      status: s.status,
      products: products.map((p) => ({
        code: p.code,
        name: p.product.name,
        imageUrl: p.product.imageUrl,
        price: p.livePrice ?? p.product.price,
        status: p.status,
        available: p.available,
      })),
    };
  });

  /** Tra cứu đơn theo @username TikTok hoặc tên Facebook */
  app.get('/api/public/s/:publicId/lookup', { preHandler: limitLookup }, async (req, reply) => {
    const { publicId } = req.params as { publicId: string };
    const q = String((req.query as { q?: string }).q ?? '').trim();
    const s = await findSession(publicId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    if (q.length < 2) return [];
    const orders = await sales.lookup(s.id, q);
    return orders.slice(0, 10).map((o) => ({
      code: o.code,
      name: maskName(o.displayName ?? o.handle),
      status: o.status,
      total: o.total,
      token: o.confirmToken,
      items: o.items.map((i) => ({ code: i.code, productName: i.productName, variantLabel: i.variantLabel, quantity: i.quantity, status: i.status })),
    }));
  });

  /** Dữ liệu cho overlay OBS: sản phẩm đang bán + đơn mới nhất */
  app.get('/api/public/s/:publicId/overlay', { preHandler: limitRead }, async (req, reply) => {
    const { publicId } = req.params as { publicId: string };
    const s = await findSession(publicId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const products = await sales.sessionProducts(s.id);
    const selling = products
      .filter((p) => p.status === 'SELLING')
      .sort((a, b) => new Date(b.openedAt ?? 0).getTime() - new Date(a.openedAt ?? 0).getTime());
    const recent = await db.orderItem.findMany({
      where: { order: { sessionId: s.id }, status: 'RESERVED', createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { order: { select: { displayName: true, handle: true } } },
    });
    return {
      shopName: s.shop.name,
      selling: selling.map((p) => ({
        code: p.code,
        name: p.product.name,
        imageUrl: p.product.imageUrl,
        price: p.livePrice ?? p.product.price,
        originalPrice: p.product.price,
        available: p.available,
        sessionLimit: p.sessionLimit,
      })),
      recent: recent.map((i) => ({
        id: i.id,
        name: maskName(i.order.displayName ?? i.order.handle),
        code: i.code,
        variantLabel: i.variantLabel,
        quantity: i.quantity,
        at: i.createdAt,
      })),
    };
  });

  /** Game đang hiện trên overlay (không lộ đáp án trước khi công bố) */
  app.get('/api/public/s/:publicId/game', { preHandler: limitRead }, async (req, reply) => {
    const { publicId } = req.params as { publicId: string };
    const s = await findSession(publicId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    return { shopName: s.shop.name, game: games ? await games.overlay(s.id) : null, now: Date.now() };
  });

  /** Xem đơn theo link / QR bí mật */
  app.get('/api/public/o/:token', { preHandler: limitRead }, async (req, reply) => {
    const { token } = req.params as { token: string };
    try {
      const o = await sales.getByToken(token);
      const shop = o.session.shop;
      const c = o.customer;
      return {
        code: o.code,
        shopName: shop.name,
        sessionTitle: o.session.title,
        status: o.status,
        total: o.total,
        holdUntil: o.holdUntil,
        displayName: o.displayName ?? o.handle,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        bankAvailable: !!(shop.bankBin && shop.bankAccountNo),
        // Không trả lại thông tin đã lưu đầy đủ, chỉ dạng che bớt
        saved:
          c && c.phone && c.address
            ? { name: maskName(c.name), phone: maskPhone(c.phone), address: maskAddress(c.address) }
            : null,
        receiver:
          o.status !== 'PENDING' && o.receiverPhone
            ? { name: maskName(o.receiverName), phone: maskPhone(o.receiverPhone), address: o.receiverAddress ? maskAddress(o.receiverAddress) : '' }
            : null,
        items: o.items.map((i) => ({
          id: i.id,
          code: i.code,
          productName: i.productName,
          imageUrl: i.sessionProduct.product.imageUrl,
          variantLabel: i.variantLabel,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          status: i.status,
          variants:
            i.status === 'NEEDS_VARIANT'
              ? i.sessionProduct.product.variants.map((v) => ({ id: v.id, label: variantLabel(v.options) ?? 'Mặc định', available: Math.max(0, v.stock - v.reserved) }))
              : undefined,
        })),
      };
    } catch (e) {
      if (e instanceof SalesError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.post('/api/public/o/:token/confirm', { preHandler: limitWrite }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    try {
      const o = await sales.confirmByCustomer(token, parsed.data);
      return { ok: true, code: o.code, total: o.total, status: o.status };
    } catch (e) {
      if (e instanceof SalesError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  /** Mã VietQR để khách chuyển khoản (nội dung = mã đơn) */
  app.get('/api/public/o/:token/payment', { preHandler: limitRead }, async (req, reply) => {
    const { token } = req.params as { token: string };
    try {
      const o = await sales.getByToken(token);
      const shop = o.session.shop;
      if (!shop.bankBin || !shop.bankAccountNo) return reply.code(400).send({ error: 'Shop chưa cài đặt chuyển khoản' });
      const note = `${o.code}`;
      return {
        payload: buildVietQrPayload({ bin: shop.bankBin, accountNo: shop.bankAccountNo, amount: o.total, note }),
        bankBin: shop.bankBin,
        accountNo: shop.bankAccountNo,
        accountName: shop.bankAccountName,
        amount: o.total,
        note,
      };
    } catch (e) {
      if (e instanceof SalesError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
}
