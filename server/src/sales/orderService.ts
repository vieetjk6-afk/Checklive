import crypto from 'node:crypto';
import { Prisma, type OrderStatus, type PaymentMethod, type PaymentStatus, type Platform } from '@prisma/client';
import type { DB } from '../db.js';
import { extractPhones, normalizeText } from '../core/text.js';
import { normalizeCode, parseOrderComment, tokenize, type ParserProduct } from './parser.js';

type Tx = Prisma.TransactionClient;

export class SalesError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Đơn còn hiệu lực (đang giữ hàng) */
export const ACTIVE_ORDER: OrderStatus[] = ['PENDING', 'CONFIRMED', 'APPROVED'];
/** Đơn còn được gộp thêm sản phẩm từ bình luận mới */
const APPENDABLE_ORDER: OrderStatus[] = ['PENDING', 'CONFIRMED'];

export function variantLabel(options: unknown): string | null {
  const vals = Object.values((options ?? {}) as Record<string, string>).filter(Boolean);
  return vals.length ? vals.join(' / ') : null;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(len = 6): string {
  const bytes = crypto.randomBytes(len);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export interface CustomerIdent {
  platform: Platform;
  platformUserId: string;
  name?: string;
  handle?: string;
}

export interface LineInput {
  sessionProductId: string;
  variantId?: string;
  quantity: number;
}

interface SpInfo {
  code: string;
  productId: string;
  productName: string;
  price: number;
  livePrice: number | null;
  perCustomerLimit: number | null;
  variants: Map<string, { label: string | null; price: number | null }>;
}

interface SalesContext {
  sessionId: string;
  shopId: string;
  holdMinutes: number | null;
  mode: 'ALL_CODES' | 'SELLING_ONLY';
  keywords: string[];
  parserProducts: ParserProduct[];
  info: Map<string, SpInfo>;
}

export interface LineResult {
  code: string;
  label: string | null;
  reserved: number;
  waitlisted: number;
  needsVariant: number;
  skippedByLimit: boolean;
}

export interface CommentOutcome {
  tag?: string;
  tagKind?: 'order' | 'waitlist' | 'warn' | 'question';
  orderId?: string;
}

const orderInclude = {
  items: { orderBy: { createdAt: 'asc' } },
  customer: { select: { id: true, name: true, phone: true, address: true, blacklisted: true, note: true } },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrderDTO(o: OrderWithItems) {
  return {
    id: o.id,
    code: o.code,
    sessionId: o.sessionId,
    status: o.status,
    platform: o.platform,
    platformUserId: o.platformUserId,
    displayName: o.displayName,
    handle: o.handle,
    customer: o.customer,
    receiverName: o.receiverName,
    receiverPhone: o.receiverPhone,
    receiverAddress: o.receiverAddress,
    note: o.note,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    total: o.total,
    holdUntil: o.holdUntil,
    confirmToken: o.confirmToken,
    cancelReason: o.cancelReason,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    confirmedAt: o.confirmedAt,
    approvedAt: o.approvedAt,
    completedAt: o.completedAt,
    items: o.items.map((i) => ({
      id: i.id,
      sessionProductId: i.sessionProductId,
      variantId: i.variantId,
      code: i.code,
      productName: i.productName,
      variantLabel: i.variantLabel,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      status: i.status,
      sourceText: i.sourceText,
      createdAt: i.createdAt,
    })),
  };
}
export type OrderDTO = ReturnType<typeof toOrderDTO>;

export interface SalesNotifier {
  order(sessionId: string, order: OrderDTO): void;
  productsChanged(sessionId: string): void;
}

/**
 * Xử lý đơn hàng: tạo đơn từ bình luận, giữ hàng, danh sách chờ, xác nhận, huỷ, hết hạn.
 * Mọi thao tác trừ/cộng tồn kho đều khoá dòng (FOR UPDATE) nên không bán quá số lượng
 * kể cả khi nhiều bình luận đến cùng lúc.
 */
export class OrderService {
  private contexts = new Map<string, SalesContext>();

  constructor(
    private db: DB,
    private notify: SalesNotifier = { order: () => {}, productsChanged: () => {} },
  ) {}

  // ───────────── Ngữ cảnh phiên (sản phẩm, cấu hình) ─────────────

  invalidate(sessionId: string) {
    this.contexts.delete(sessionId);
  }

  invalidateAll() {
    this.contexts.clear();
  }

  private async context(sessionId: string): Promise<SalesContext> {
    const cached = this.contexts.get(sessionId);
    if (cached) return cached;
    const s = await this.db.liveSession.findUnique({
      where: { id: sessionId },
      include: { products: { include: { product: { include: { variants: { orderBy: { sortOrder: 'asc' } } } } } } },
    });
    if (!s) throw new SalesError('Không tìm thấy phiên live', 404);
    const ctx: SalesContext = {
      sessionId,
      shopId: s.shopId,
      holdMinutes: s.holdMinutes,
      mode: s.orderMode,
      keywords: s.orderKeywords,
      parserProducts: s.products.map((sp) => ({
        id: sp.id,
        code: sp.code,
        status: sp.status,
        openedAt: sp.openedAt?.getTime() ?? null,
        variants: sp.product.variants.map((v) => ({ id: v.id, options: (v.options ?? {}) as Record<string, string> })),
      })),
      info: new Map(
        s.products.map((sp) => [
          sp.id,
          {
            code: sp.code,
            productId: sp.productId,
            productName: sp.product.name,
            price: sp.product.price,
            livePrice: sp.livePrice,
            perCustomerLimit: sp.perCustomerLimit,
            variants: new Map(sp.product.variants.map((v) => [v.id, { label: variantLabel(v.options), price: v.price }])),
          },
        ]),
      ),
    };
    this.contexts.set(sessionId, ctx);
    return ctx;
  }

  // ───────────── Tồn kho ─────────────

  /** Giữ hàng. Trả về số lượng giữ được (0..qty). allOrNothing: giữ đủ hoặc không giữ. */
  private async reserve(tx: Tx, spId: string, variantId: string, qty: number, allOrNothing = false): Promise<number> {
    // Luôn khoá theo thứ tự: biến thể -> sản phẩm phiên (tránh khoá chéo)
    const [v] = await tx.$queryRaw<{ stock: number; reserved: number }[]>`
      SELECT stock, reserved FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
    const [sp] = await tx.$queryRaw<{ sessionLimit: number | null; reservedQty: number }[]>`
      SELECT "sessionLimit", "reservedQty" FROM "SessionProduct" WHERE id = ${spId} FOR UPDATE`;
    if (!v || !sp) return 0;
    let avail = Math.max(0, v.stock - v.reserved);
    if (sp.sessionLimit !== null) avail = Math.min(avail, Math.max(0, sp.sessionLimit - sp.reservedQty));
    const take = allOrNothing ? (avail >= qty ? qty : 0) : Math.min(qty, avail);
    if (take > 0) {
      await tx.$executeRaw`UPDATE "ProductVariant" SET reserved = reserved + ${take} WHERE id = ${variantId}`;
      await tx.$executeRaw`UPDATE "SessionProduct" SET "reservedQty" = "reservedQty" + ${take} WHERE id = ${spId}`;
    }
    return take;
  }

  private async release(tx: Tx, spId: string, variantId: string | null, qty: number) {
    if (qty <= 0) return;
    if (variantId) await tx.$executeRaw`UPDATE "ProductVariant" SET reserved = GREATEST(reserved - ${qty}, 0) WHERE id = ${variantId}`;
    await tx.$executeRaw`UPDATE "SessionProduct" SET "reservedQty" = GREATEST("reservedQty" - ${qty}, 0) WHERE id = ${spId}`;
  }

  /** Tính lại tổng tiền; đặt hạn giữ hàng nếu đơn đang chờ và vừa có hàng được giữ. */
  private async recalc(tx: Tx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, session: { select: { holdMinutes: true } } },
    });
    const total = order.items
      .filter((i) => i.status === 'RESERVED' || i.status === 'NEEDS_VARIANT')
      .reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const data: Prisma.OrderUpdateInput = { total };
    const hasReserved = order.items.some((i) => i.status === 'RESERVED');
    if (order.status === 'PENDING' && !order.holdUntil && hasReserved && order.session.holdMinutes) {
      data.holdUntil = new Date(Date.now() + order.session.holdMinutes * 60_000);
    }
    await tx.order.update({ where: { id: orderId }, data });
  }

  /** Giữ hàng cho 1 dòng có phân loại rõ: phần giữ được -> RESERVED (gộp dòng cũ), phần thiếu -> WAITLIST */
  private async placeLine(
    tx: Tx,
    orderId: string,
    info: SpInfo,
    spId: string,
    variantId: string,
    qty: number,
    sourceText: string | null,
  ): Promise<{ reserved: number; waitlisted: number }> {
    const v = info.variants.get(variantId);
    const unitPrice = info.livePrice ?? v?.price ?? info.price;
    const got = await this.reserve(tx, spId, variantId, qty);
    if (got > 0) {
      const existing = await tx.orderItem.findFirst({ where: { orderId, sessionProductId: spId, variantId, status: 'RESERVED' } });
      if (existing) {
        await tx.orderItem.update({ where: { id: existing.id }, data: { quantity: { increment: got } } });
      } else {
        await tx.orderItem.create({
          data: { orderId, sessionProductId: spId, variantId, code: info.code, productName: info.productName, variantLabel: v?.label ?? null, unitPrice, quantity: got, status: 'RESERVED', sourceText },
        });
      }
    }
    if (qty - got > 0) {
      await tx.orderItem.create({
        data: { orderId, sessionProductId: spId, variantId, code: info.code, productName: info.productName, variantLabel: v?.label ?? null, unitPrice, quantity: qty - got, status: 'WAITLIST', sourceText },
      });
    }
    return { reserved: got, waitlisted: qty - got };
  }

  private async newOrderCode(tx: Tx): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = randomCode();
      if (!(await tx.order.findUnique({ where: { code }, select: { id: true } }))) return code;
    }
    throw new Error('Không tạo được mã đơn');
  }

  // ───────────── Tạo đơn ─────────────

  /** Thêm sản phẩm vào đơn đang mở của khách (tạo đơn mới nếu chưa có) */
  async addLines(
    sessionId: string,
    ident: CustomerIdent,
    lines: LineInput[],
    opts: { sourceText?: string; phones?: string[] } = {},
  ): Promise<{ order: OrderDTO; results: LineResult[] }> {
    const ctx = await this.context(sessionId);
    const results: LineResult[] = [];
    const touchedVariants = new Set<string>();

    const orderId = await this.db.$transaction(
      async (tx) => {
        // Khách hàng
        let identity = await tx.customerIdentity.findUnique({
          where: { shopId_platform_platformUserId: { shopId: ctx.shopId, platform: ident.platform, platformUserId: ident.platformUserId } },
        });
        if (!identity) {
          const customer = await tx.customer.create({
            data: { shopId: ctx.shopId, name: ident.name || ident.handle || 'Khách', phone: opts.phones?.[0] ?? null },
          });
          identity = await tx.customerIdentity.create({
            data: { shopId: ctx.shopId, customerId: customer.id, platform: ident.platform, platformUserId: ident.platformUserId, name: ident.name, handle: ident.handle },
          });
        } else if ((ident.name && ident.name !== identity.name) || (ident.handle && ident.handle !== identity.handle)) {
          await tx.customerIdentity.update({ where: { id: identity.id }, data: { name: ident.name ?? identity.name, handle: ident.handle ?? identity.handle } });
        }

        // Đơn đang mở
        let order = await tx.order.findFirst({
          where: { sessionId, platform: ident.platform, platformUserId: ident.platformUserId, status: { in: APPENDABLE_ORDER } },
          orderBy: { createdAt: 'desc' },
        });
        if (!order) {
          order = await tx.order.create({
            data: {
              shopId: ctx.shopId,
              sessionId,
              code: await this.newOrderCode(tx),
              confirmToken: crypto.randomBytes(18).toString('base64url'),
              customerId: identity.customerId,
              platform: ident.platform,
              platformUserId: ident.platformUserId,
              displayName: ident.name ?? null,
              handle: ident.handle ?? null,
              receiverPhone: opts.phones?.[0] ?? null,
            },
          });
        } else if (opts.phones?.[0] && !order.receiverPhone) {
          await tx.order.update({ where: { id: order.id }, data: { receiverPhone: opts.phones[0] } });
        }

        for (const line of lines) {
          const info = ctx.info.get(line.sessionProductId);
          if (!info) continue;
          const res: LineResult = {
            code: info.code,
            label: line.variantId ? info.variants.get(line.variantId)?.label ?? null : null,
            reserved: 0,
            waitlisted: 0,
            needsVariant: 0,
            skippedByLimit: false,
          };
          results.push(res);
          let qty = Math.max(1, Math.min(99, Math.round(line.quantity)));
          if (info.perCustomerLimit) {
            const agg = await tx.orderItem.aggregate({
              _sum: { quantity: true },
              where: {
                sessionProductId: line.sessionProductId,
                status: { in: ['RESERVED', 'WAITLIST', 'NEEDS_VARIANT'] },
                order: { sessionId, platform: ident.platform, platformUserId: ident.platformUserId, status: { in: ACTIVE_ORDER } },
              },
            });
            qty = Math.min(qty, info.perCustomerLimit - (agg._sum.quantity ?? 0));
            if (qty <= 0) {
              res.skippedByLimit = true;
              continue;
            }
          }
          // Sản phẩm chỉ có 1 phân loại thì không cần khách chọn
          const variantId = line.variantId ?? (info.variants.size === 1 ? [...info.variants.keys()][0] : undefined);
          if (variantId && info.variants.has(variantId)) {
            const r = await this.placeLine(tx, order.id, info, line.sessionProductId, variantId, qty, opts.sourceText ?? null);
            res.label = info.variants.get(variantId)?.label ?? null;
            res.reserved = r.reserved;
            res.waitlisted = r.waitlisted;
            touchedVariants.add(variantId);
          } else {
            await tx.orderItem.create({
              data: {
                orderId: order.id, sessionProductId: line.sessionProductId, variantId: null, code: info.code, productName: info.productName,
                variantLabel: null, unitPrice: info.livePrice ?? info.price, quantity: qty, status: 'NEEDS_VARIANT', sourceText: opts.sourceText ?? null,
              },
            });
            res.needsVariant = qty;
          }
        }
        await this.recalc(tx, order.id);
        return order.id;
      },
      { timeout: 15_000 },
    );

    const order = await this.getOrder(orderId);
    this.notify.order(sessionId, order);
    if (touchedVariants.size) this.notify.productsChanged(sessionId);
    return { order, results };
  }

  /** Xử lý 1 bình luận trong lúc live: đọc cú pháp và tạo / gộp đơn */
  async handleComment(sessionId: string, c: { platform: Platform; user?: { id: string; name?: string; handle?: string }; content: string }): Promise<CommentOutcome> {
    const ctx = await this.context(sessionId);
    if (ctx.parserProducts.length === 0) return {};
    const parsed = parseOrderComment(c.content, ctx.parserProducts, { mode: ctx.mode, keywords: ctx.keywords });

    if (parsed.lines.length === 0) {
      if (parsed.isQuestion) {
        const codes = new Set(ctx.parserProducts.map((p) => normalizeCode(p.code)));
        if (tokenize(c.content).some((t) => codes.has(t))) return { tag: 'Câu hỏi về sản phẩm — chưa tạo đơn', tagKind: 'question' };
      }
      if (parsed.ignoredCodes.length) {
        return { tag: `Mã ${parsed.ignoredCodes.join(', ')} đã đóng hoặc chưa mở bán`, tagKind: 'warn' };
      }
      if (parsed.unknownCodes.length) {
        return { tag: `Mã ${parsed.unknownCodes.join(', ')} không có trong phiên`, tagKind: 'warn' };
      }
      return {};
    }
    if (!c.user) return { tag: 'Không rõ người bình luận — hãy tạo đơn thủ công', tagKind: 'warn' };

    const { order, results } = await this.addLines(
      sessionId,
      { platform: c.platform, platformUserId: c.user.id, name: c.user.name, handle: c.user.handle },
      parsed.lines.map((l) => ({ sessionProductId: l.sessionProductId, variantId: l.variantId, quantity: l.quantity })),
      { sourceText: c.content, phones: parsed.phones },
    );

    const parts: string[] = [];
    let kind: CommentOutcome['tagKind'] = 'order';
    for (const r of results) {
      const name = `${r.code}${r.label ? ` ${r.label}` : ''}`;
      if (r.skippedByLimit) {
        parts.push(`${name}: vượt giới hạn mỗi khách`);
        kind = 'warn';
        continue;
      }
      if (r.reserved) parts.push(`${name} ×${r.reserved}`);
      if (r.needsVariant) parts.push(`${name} ×${r.needsVariant} (chưa rõ phân loại)`);
      if (r.waitlisted) {
        parts.push(`${name} ×${r.waitlisted} hết hàng → danh sách chờ`);
        if (kind === 'order') kind = 'waitlist';
      }
    }
    if (parsed.unknownCodes.length) parts.push(`mã ${parsed.unknownCodes.join(', ')} không có trong phiên`);
    return { tag: `Đơn ${order.code}: ${parts.join(', ')}`, tagKind: kind, orderId: order.id };
  }

  // ───────────── Đọc đơn ─────────────

  async getOrder(orderId: string): Promise<OrderDTO> {
    const o = await this.db.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!o) throw new SalesError('Không tìm thấy đơn hàng', 404);
    return toOrderDTO(o);
  }

  async listOrders(sessionId: string, status?: OrderStatus): Promise<OrderDTO[]> {
    const list = await this.db.order.findMany({
      where: { sessionId, ...(status ? { status } : {}) },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    return list.map(toOrderDTO);
  }

  private async findForShop(orderId: string, shopId: string) {
    const o = await this.db.order.findFirst({ where: { id: orderId, shopId }, select: { id: true, sessionId: true, status: true } });
    if (!o) throw new SalesError('Không tìm thấy đơn hàng', 404);
    return o;
  }

  private async emit(orderId: string, productsChanged = false): Promise<OrderDTO> {
    const order = await this.getOrder(orderId);
    this.notify.order(order.sessionId, order);
    if (productsChanged) this.notify.productsChanged(order.sessionId);
    return order;
  }

  // ───────────── Danh sách chờ ─────────────

  /** Có hàng trở lại (huỷ đơn, tăng tồn kho…) -> chuyển khách đang chờ sang giữ hàng, ai chờ trước được trước */
  async promoteWaitlist(variantId: string): Promise<void> {
    const waiting = await this.db.orderItem.findMany({
      where: { variantId, status: 'WAITLIST', order: { status: { in: ACTIVE_ORDER } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, orderId: true, sessionProductId: true, quantity: true },
    });
    const blocked = new Set<string>();
    const touched = new Set<string>();
    for (const w of waiting) {
      if (blocked.has(w.sessionProductId)) continue;
      const ok = await this.db.$transaction(async (tx) => {
        const got = await this.reserve(tx, w.sessionProductId, variantId, w.quantity, true);
        if (got === 0) return false;
        await tx.orderItem.update({ where: { id: w.id }, data: { status: 'RESERVED' } });
        await this.recalc(tx, w.orderId);
        return true;
      });
      if (!ok) blocked.add(w.sessionProductId);
      else touched.add(w.orderId);
    }
    for (const id of touched) await this.emit(id, true);
  }

  // ───────────── Thao tác của nhân viên ─────────────

  async updateOrder(
    orderId: string,
    shopId: string,
    data: { receiverName?: string | null; receiverPhone?: string | null; receiverAddress?: string | null; note?: string | null; paymentMethod?: PaymentMethod; paymentStatus?: PaymentStatus },
  ): Promise<OrderDTO> {
    await this.findForShop(orderId, shopId);
    await this.db.order.update({ where: { id: orderId }, data });
    return this.emit(orderId);
  }

  async approve(orderId: string, shopId: string): Promise<OrderDTO> {
    const o = await this.findForShop(orderId, shopId);
    if (!['PENDING', 'CONFIRMED'].includes(o.status)) throw new SalesError('Chỉ chốt được đơn đang chờ hoặc khách đã xác nhận');
    await this.db.order.update({ where: { id: orderId }, data: { status: 'APPROVED', approvedAt: new Date(), holdUntil: null } });
    return this.emit(orderId);
  }

  /** Huỷ đơn: nhả hàng đang giữ, chuyển cho người chờ */
  async cancel(orderId: string, shopId: string | null, reason?: string, status: 'CANCELLED' | 'EXPIRED' = 'CANCELLED'): Promise<OrderDTO> {
    const released = new Set<string>();
    await this.db.$transaction(async (tx) => {
      const o = await tx.order.findFirst({ where: { id: orderId, ...(shopId ? { shopId } : {}) }, include: { items: true } });
      if (!o) throw new SalesError('Không tìm thấy đơn hàng', 404);
      if (!ACTIVE_ORDER.includes(o.status)) throw new SalesError('Đơn này không còn huỷ được');
      for (const i of o.items) {
        if (i.status === 'RESERVED') {
          await this.release(tx, i.sessionProductId, i.variantId, i.quantity);
          if (i.variantId) released.add(i.variantId);
        }
      }
      await tx.orderItem.updateMany({ where: { orderId, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } });
      await tx.order.update({
        where: { id: orderId },
        data: { status, cancelReason: reason ?? null, cancelledAt: new Date(), holdUntil: null, total: 0 },
      });
    });
    const order = await this.emit(orderId, released.size > 0);
    for (const v of released) await this.promoteWaitlist(v);
    return order;
  }

  /** Đã giao xong: trừ tồn kho thực tế */
  async complete(orderId: string, shopId: string): Promise<OrderDTO> {
    await this.db.$transaction(async (tx) => {
      const o = await tx.order.findFirst({ where: { id: orderId, shopId }, include: { items: true } });
      if (!o) throw new SalesError('Không tìm thấy đơn hàng', 404);
      if (o.status !== 'APPROVED') throw new SalesError('Chỉ hoàn tất được đơn đã chốt');
      for (const i of o.items) {
        if (i.status === 'RESERVED' && i.variantId) {
          await tx.$executeRaw`UPDATE "ProductVariant" SET stock = GREATEST(stock - ${i.quantity}, 0), reserved = GREATEST(reserved - ${i.quantity}, 0) WHERE id = ${i.variantId}`;
        }
      }
      await tx.orderItem.updateMany({ where: { orderId, status: { in: ['WAITLIST', 'NEEDS_VARIANT'] } }, data: { status: 'CANCELLED' } });
      await tx.order.update({ where: { id: orderId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await this.recalc(tx, orderId);
    });
    return this.emit(orderId, true);
  }

  /** Chọn phân loại cho dòng chưa rõ (hoặc đổi phân loại) */
  async setItemVariant(itemId: string, shopId: string | null, variantId: string): Promise<OrderDTO> {
    const released: string[] = [];
    const orderId = await this.db.$transaction(async (tx) => {
      const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { order: true, sessionProduct: { include: { product: { include: { variants: true } } } } } });
      if (!item || (shopId && item.order.shopId !== shopId)) throw new SalesError('Không tìm thấy dòng hàng', 404);
      if (!ACTIVE_ORDER.includes(item.order.status)) throw new SalesError('Đơn không còn sửa được');
      if (item.status === 'CANCELLED') throw new SalesError('Dòng hàng đã huỷ');
      const variant = item.sessionProduct.product.variants.find((v) => v.id === variantId);
      if (!variant) throw new SalesError('Phân loại không thuộc sản phẩm này');
      if (item.variantId === variantId && item.status !== 'NEEDS_VARIANT') return item.orderId;
      if (item.status === 'RESERVED') {
        await this.release(tx, item.sessionProductId, item.variantId, item.quantity);
        if (item.variantId) released.push(item.variantId);
      }
      await tx.orderItem.update({ where: { id: itemId }, data: { status: 'CANCELLED' } });
      const ctx = await this.context(item.order.sessionId);
      const info = ctx.info.get(item.sessionProductId);
      if (!info) throw new SalesError('Sản phẩm không còn trong phiên');
      await this.placeLine(tx, item.orderId, info, item.sessionProductId, variantId, item.quantity, item.sourceText);
      // Dòng cũ đã thay thế bằng dòng mới: xoá hẳn để đơn gọn
      await tx.orderItem.delete({ where: { id: itemId } });
      await this.recalc(tx, item.orderId);
      return item.orderId;
    });
    const order = await this.emit(orderId, true);
    for (const v of released) if (v !== variantId) await this.promoteWaitlist(v);
    return order;
  }

  /** Đổi số lượng 1 dòng (0 = bỏ dòng) */
  async setItemQuantity(itemId: string, shopId: string, quantity: number): Promise<OrderDTO> {
    const q = Math.max(0, Math.min(99, Math.round(quantity)));
    let releasedVariant: string | null = null;
    const orderId = await this.db.$transaction(async (tx) => {
      const item = await tx.orderItem.findUnique({ where: { id: itemId }, include: { order: true } });
      if (!item || item.order.shopId !== shopId) throw new SalesError('Không tìm thấy dòng hàng', 404);
      if (!ACTIVE_ORDER.includes(item.order.status)) throw new SalesError('Đơn không còn sửa được');
      if (item.status === 'CANCELLED') throw new SalesError('Dòng hàng đã huỷ');
      const delta = q - item.quantity;
      if (item.status === 'RESERVED' && item.variantId) {
        if (delta < 0) {
          await this.release(tx, item.sessionProductId, item.variantId, -delta);
          releasedVariant = item.variantId;
        } else if (delta > 0) {
          const got = await this.reserve(tx, item.sessionProductId, item.variantId, delta);
          if (got < delta) throw new SalesError(`Chỉ còn ${got} sản phẩm để thêm`);
        }
      }
      if (q === 0) await tx.orderItem.update({ where: { id: itemId }, data: { status: 'CANCELLED' } });
      else await tx.orderItem.update({ where: { id: itemId }, data: { quantity: q } });
      await this.recalc(tx, item.orderId);
      return item.orderId;
    });
    const order = await this.emit(orderId, true);
    if (releasedVariant) await this.promoteWaitlist(releasedVariant);
    return order;
  }

  /** Huỷ đơn quá hạn giữ hàng. Gọi định kỳ. */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.db.order.findMany({ where: { status: 'PENDING', holdUntil: { lt: now } }, select: { id: true }, take: 100 });
    for (const o of due) {
      try {
        await this.cancel(o.id, null, 'Quá thời gian giữ hàng', 'EXPIRED');
      } catch (err) {
        console.error('Không huỷ được đơn quá hạn', o.id, err);
      }
    }
    return due.length;
  }

  // ───────────── Khách tự xác nhận (trang công khai) ─────────────

  async getByToken(token: string) {
    const o = await this.db.order.findUnique({
      where: { confirmToken: token },
      include: {
        items: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' }, include: { sessionProduct: { include: { product: { include: { variants: { orderBy: { sortOrder: 'asc' } } } } } } } },
        customer: true,
        session: { include: { shop: true } },
      },
    });
    if (!o) throw new SalesError('Không tìm thấy đơn hàng', 404);
    return o;
  }

  async confirmByCustomer(
    token: string,
    input: {
      receiverName?: string;
      receiverPhone?: string;
      receiverAddress?: string;
      note?: string;
      paymentMethod: PaymentMethod;
      useSaved?: boolean;
      variantChoices?: Record<string, string>;
    },
  ): Promise<OrderDTO> {
    const o = await this.getByToken(token);
    if (!['PENDING', 'CONFIRMED'].includes(o.status)) {
      throw new SalesError(o.status === 'APPROVED' || o.status === 'COMPLETED' ? 'Đơn đã được shop chốt' : 'Đơn đã huỷ hoặc hết hạn giữ hàng');
    }
    const saved = input.useSaved ? o.customer : null;
    const name = (input.receiverName || saved?.name || '').trim();
    const phoneRaw = (input.receiverPhone || saved?.phone || '').trim();
    const address = (input.receiverAddress || saved?.address || '').trim();
    const phone = extractPhones(phoneRaw)[0];
    if (name.length < 2) throw new SalesError('Vui lòng nhập họ tên người nhận');
    if (!phone) throw new SalesError('Số điện thoại không hợp lệ');
    if (address.length < 8) throw new SalesError('Vui lòng nhập địa chỉ nhận hàng đầy đủ');

    for (const item of o.items.filter((i) => i.status === 'NEEDS_VARIANT')) {
      const choice = input.variantChoices?.[item.id];
      if (choice) await this.setItemVariant(item.id, null, choice);
    }

    await this.db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: o.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          holdUntil: null,
          receiverName: name,
          receiverPhone: phone,
          receiverAddress: address,
          note: input.note?.trim() || null,
          paymentMethod: input.paymentMethod,
        },
      });
      if (o.customerId) {
        await tx.customer.update({ where: { id: o.customerId }, data: { name, phone, address } });
      }
    });
    return this.emit(o.id);
  }

  /** Tra cứu đơn theo @username TikTok hoặc tên Facebook (khớp chính xác, không phân biệt dấu) */
  async lookup(sessionId: string, query: string) {
    const q = normalizeText(query.replace(/^@/, ''));
    if (q.length < 2) return [];
    const orders = await this.db.order.findMany({
      where: { sessionId, status: { in: ['PENDING', 'CONFIRMED'] } },
      include: { items: { where: { status: { not: 'CANCELLED' } } } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    return orders.filter((o) => (o.handle && normalizeText(o.handle) === q) || (o.displayName && normalizeText(o.displayName) === q));
  }

  // ───────────── Sản phẩm trong phiên ─────────────

  async sessionProducts(sessionId: string) {
    const list = await this.db.sessionProduct.findMany({
      where: { sessionId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { product: { include: { variants: { orderBy: { sortOrder: 'asc' } } } } },
    });
    const sums = await this.db.orderItem.groupBy({
      by: ['sessionProductId', 'status'],
      where: { sessionProduct: { sessionId }, order: { status: { in: [...ACTIVE_ORDER, 'COMPLETED'] } } },
      _sum: { quantity: true },
    });
    const sumOf = (spId: string, status: string) =>
      sums.find((s) => s.sessionProductId === spId && s.status === status)?._sum.quantity ?? 0;
    return list.map((sp) => ({
      id: sp.id,
      code: sp.code,
      status: sp.status,
      livePrice: sp.livePrice,
      sessionLimit: sp.sessionLimit,
      perCustomerLimit: sp.perCustomerLimit,
      reservedQty: sp.reservedQty,
      sortOrder: sp.sortOrder,
      openedAt: sp.openedAt,
      orderedQty: sumOf(sp.id, 'RESERVED'),
      waitlistQty: sumOf(sp.id, 'WAITLIST'),
      needsVariantQty: sumOf(sp.id, 'NEEDS_VARIANT'),
      product: {
        id: sp.product.id,
        name: sp.product.name,
        imageUrl: sp.product.imageUrl,
        price: sp.product.price,
        attributes: sp.product.attributes,
        variants: sp.product.variants.map((v) => ({
          id: v.id,
          options: v.options,
          label: variantLabel(v.options),
          sku: v.sku,
          price: v.price,
          stock: v.stock,
          reserved: v.reserved,
          available: Math.max(0, v.stock - v.reserved),
        })),
      },
      /** Còn bán được trong phiên (theo tồn kho và giới hạn phiên) */
      available: Math.min(
        sp.product.variants.reduce((s, v) => s + Math.max(0, v.stock - v.reserved), 0),
        sp.sessionLimit === null ? Number.MAX_SAFE_INTEGER : Math.max(0, sp.sessionLimit - sp.reservedQty),
      ),
    }));
  }
}

export type SessionProductDTO = Awaited<ReturnType<OrderService['sessionProducts']>>[number];
