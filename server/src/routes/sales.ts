import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { requireAuth } from '../auth.js';
import { normalizeText } from '../core/text.js';
import { isValidCode, normalizeCode } from '../sales/parser.js';
import { SalesError, type OrderService } from '../sales/orderService.js';
import { buildOrdersWorkbook } from '../sales/exportOrders.js';

const intOrNull = z.number().int().min(0).nullable().optional();

const spCreate = z.object({
  productId: z.string(),
  code: z.string().trim().max(20).optional(),
  livePrice: intOrNull,
  sessionLimit: intOrNull,
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
});

const spUpdate = z.object({
  code: z.string().trim().max(20).optional(),
  livePrice: intOrNull,
  sessionLimit: intOrNull,
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
  status: z.enum(['WAITING', 'SELLING', 'CLOSED']).optional(),
  sortOrder: z.number().int().optional(),
});

const settingsSchema = z.object({
  holdMinutes: z.number().int().min(5).max(60 * 24 * 30).nullable().optional(),
  orderMode: z.enum(['ALL_CODES', 'SELLING_ONLY']).optional(),
  orderKeywords: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
});

const orderUpdate = z.object({
  receiverName: z.string().trim().max(100).nullable().optional(),
  receiverPhone: z.string().trim().max(20).nullable().optional(),
  receiverAddress: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  paymentMethod: z.enum(['COD', 'BANK']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PAID']).optional(),
});

const manualOrder = z.object({
  platform: z.enum(['TIKTOK', 'FACEBOOK', 'SIMULATOR']),
  platformUserId: z.string().min(1),
  name: z.string().optional(),
  handle: z.string().optional(),
  sourceText: z.string().max(1000).optional(),
  items: z
    .array(z.object({ sessionProductId: z.string(), variantId: z.string().optional(), quantity: z.number().int().min(1).max(99) }))
    .min(1),
});

/** Gợi ý mã tiếp theo: A1, A2, … */
export function nextCode(existing: string[]): string {
  const used = new Set(existing.map(normalizeCode));
  for (let i = 1; ; i++) if (!used.has(`a${i}`)) return `A${i}`;
}

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof SalesError) return reply.code(e.status).send({ error: e.message });
  throw e;
}

export function salesRoutes(app: FastifyInstance, db: DB, sales: OrderService, onProductsChanged: (sessionId: string) => void) {
  app.addHook('preHandler', requireAuth);

  const session = (id: string, shopId: string) => db.liveSession.findFirst({ where: { id, shopId } });

  // ───── Sản phẩm trong phiên ─────

  app.get('/api/sessions/:id/products', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await session(id, req.user.shopId))) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    return sales.sessionProducts(id);
  });

  app.post('/api/sessions/:id/products', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await session(id, req.user.shopId))) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const parsed = spCreate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const product = await db.product.findFirst({ where: { id: parsed.data.productId, shopId: req.user.shopId } });
    if (!product) return reply.code(400).send({ error: 'Sản phẩm không tồn tại' });
    const existing = await db.sessionProduct.findMany({ where: { sessionId: id }, select: { code: true, sortOrder: true } });
    const code = parsed.data.code || nextCode(existing.map((e) => e.code));
    if (!isValidCode(code)) return reply.code(400).send({ error: 'Mã chỉ gồm chữ, số, - hoặc _ (tối đa 20 ký tự, không dấu cách)' });
    if (existing.some((e) => normalizeCode(e.code) === normalizeCode(code))) return reply.code(409).send({ error: `Mã ${code} đã dùng trong phiên` });
    const sp = await db.sessionProduct.create({
      data: {
        sessionId: id,
        productId: product.id,
        code: code.toUpperCase(),
        codeNorm: normalizeCode(code),
        livePrice: parsed.data.livePrice ?? null,
        sessionLimit: parsed.data.sessionLimit ?? null,
        perCustomerLimit: parsed.data.perCustomerLimit ?? null,
        sortOrder: Math.max(0, ...existing.map((e) => e.sortOrder)) + 1,
      },
    });
    sales.invalidate(id);
    onProductsChanged(id);
    return { id: sp.id, code: sp.code };
  });

  app.patch('/api/sessions/:id/products/:spId', async (req, reply) => {
    const { id, spId } = req.params as { id: string; spId: string };
    if (!(await session(id, req.user.shopId))) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const sp = await db.sessionProduct.findFirst({ where: { id: spId, sessionId: id }, include: { product: { include: { variants: true } } } });
    if (!sp) return reply.code(404).send({ error: 'Không tìm thấy sản phẩm trong phiên' });
    const parsed = spUpdate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.code !== undefined && normalizeCode(d.code) !== sp.codeNorm) {
      if (!isValidCode(d.code)) return reply.code(400).send({ error: 'Mã chỉ gồm chữ, số, - hoặc _ (không dấu cách)' });
      const dup = await db.sessionProduct.findFirst({ where: { sessionId: id, codeNorm: normalizeCode(d.code), NOT: { id: spId } } });
      if (dup) return reply.code(409).send({ error: `Mã ${d.code} đã dùng trong phiên` });
      data.code = d.code.toUpperCase();
      data.codeNorm = normalizeCode(d.code);
    }
    if (d.livePrice !== undefined) data.livePrice = d.livePrice;
    if (d.sessionLimit !== undefined) data.sessionLimit = d.sessionLimit;
    if (d.perCustomerLimit !== undefined) data.perCustomerLimit = d.perCustomerLimit;
    if (d.sortOrder !== undefined) data.sortOrder = d.sortOrder;
    if (d.status !== undefined && d.status !== sp.status) {
      data.status = d.status;
      if (d.status === 'SELLING') data.openedAt = new Date();
    }
    await db.sessionProduct.update({ where: { id: spId }, data });
    sales.invalidate(id);
    // Nới giới hạn phiên -> có thể chuyển khách đang chờ sang giữ hàng
    if (d.sessionLimit !== undefined && (d.sessionLimit === null || (sp.sessionLimit !== null && d.sessionLimit > sp.sessionLimit))) {
      for (const v of sp.product.variants) await sales.promoteWaitlist(v.id);
    }
    onProductsChanged(id);
    return { ok: true };
  });

  app.delete('/api/sessions/:id/products/:spId', async (req, reply) => {
    const { id, spId } = req.params as { id: string; spId: string };
    if (!(await session(id, req.user.shopId))) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const used = await db.orderItem.count({ where: { sessionProductId: spId, status: { not: 'CANCELLED' } } });
    if (used > 0) return reply.code(409).send({ error: 'Sản phẩm đã có đơn, không gỡ được. Hãy chuyển sang "Đã đóng".' });
    await db.orderItem.deleteMany({ where: { sessionProductId: spId } });
    await db.sessionProduct.deleteMany({ where: { id: spId, sessionId: id } });
    sales.invalidate(id);
    onProductsChanged(id);
    return { ok: true };
  });

  app.get('/api/sessions/:id/sales-settings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await session(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    return { holdMinutes: s.holdMinutes, orderMode: s.orderMode, orderKeywords: s.orderKeywords, publicId: s.publicId };
  });

  app.patch('/api/sessions/:id/sales-settings', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await session(id, req.user.shopId))) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const d = parsed.data;
    await db.liveSession.update({
      where: { id },
      data: {
        holdMinutes: d.holdMinutes,
        orderMode: d.orderMode,
        orderKeywords: d.orderKeywords ? [...new Set(d.orderKeywords.map((k) => normalizeText(k)).filter(Boolean))] : undefined,
      },
    });
    sales.invalidate(id);
    return { ok: true };
  });

  // ───── Đơn hàng ─────

  app.get('/api/sessions/:id/orders', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await session(id, req.user.shopId))) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    return sales.listOrders(id);
  });

  app.post('/api/sessions/:id/orders/manual', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await session(id, req.user.shopId))) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const parsed = manualOrder.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const d = parsed.data;
    try {
      const r = await sales.addLines(
        id,
        { platform: d.platform, platformUserId: d.platformUserId, name: d.name, handle: d.handle },
        d.items,
        { sourceText: d.sourceText },
      );
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get('/api/sessions/:id/orders/export.xlsx', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await session(id, req.user.shopId);
    if (!s) return reply.code(404).send({ error: 'Không tìm thấy phiên live' });
    const buf = await buildOrdersWorkbook(await sales.listOrders(id));
    const safe = s.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 60) || 'phien-live';
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="don-hang-${safe}.xlsx"`);
    return reply.send(buf);
  });

  app.patch('/api/orders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = orderUpdate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    try {
      return await sales.updateOrder(id, req.user.shopId, parsed.data);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/orders/:id/:action', async (req, reply) => {
    const { id, action } = req.params as { id: string; action: string };
    try {
      if (action === 'approve') return await sales.approve(id, req.user.shopId);
      if (action === 'complete') return await sales.complete(id, req.user.shopId);
      if (action === 'cancel') {
        const reason = z.object({ reason: z.string().max(300).optional() }).safeParse(req.body ?? {});
        return await sales.cancel(id, req.user.shopId, reason.success ? reason.data.reason : undefined);
      }
      return reply.code(404).send({ error: 'Không có thao tác này' });
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.patch('/api/orders/:id/items/:itemId', async (req, reply) => {
    const { itemId } = req.params as { id: string; itemId: string };
    const parsed = z.object({ variantId: z.string().optional(), quantity: z.number().int().min(0).max(99).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dữ liệu không hợp lệ' });
    try {
      if (parsed.data.variantId) return await sales.setItemVariant(itemId, req.user.shopId, parsed.data.variantId);
      if (parsed.data.quantity !== undefined) return await sales.setItemQuantity(itemId, req.user.shopId, parsed.data.quantity);
      return reply.code(400).send({ error: 'Không có gì để cập nhật' });
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.patch('/api/customers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ blacklisted: z.boolean().optional(), note: z.string().max(1000).nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dữ liệu không hợp lệ' });
    const c = await db.customer.findFirst({ where: { id, shopId: req.user.shopId } });
    if (!c) return reply.code(404).send({ error: 'Không tìm thấy khách hàng' });
    return db.customer.update({ where: { id }, data: parsed.data });
  });
}
