import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { requireAuth } from '../auth.js';
import { normalizeText } from '../core/text.js';
import { ACTIVE_ORDER, variantLabel, type OrderService } from '../sales/orderService.js';

const attributeSchema = z.object({
  name: z.string().trim().min(1, 'Thiếu tên thuộc tính').max(30),
  values: z.array(z.string().trim().min(1).max(40)).min(1, 'Thuộc tính cần ít nhất 1 giá trị').max(50),
});

const variantSchema = z.object({
  id: z.string().optional(),
  options: z.record(z.string(), z.string()),
  sku: z.string().trim().max(60).optional().nullable(),
  price: z.number().int().min(0).optional().nullable(),
  stock: z.number().int().min(0).max(1_000_000),
});

const productSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên sản phẩm').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  imageUrl: z.string().trim().url('Link ảnh không hợp lệ').max(1000).optional().nullable().or(z.literal('')),
  price: z.number().int().min(0, 'Giá không hợp lệ'),
  attributes: z.array(attributeSchema).max(3, 'Tối đa 3 thuộc tính phân loại'),
  variants: z.array(variantSchema).min(1).max(300),
});

type ProductInput = z.infer<typeof productSchema>;

/** Kiểm tra phân loại khớp với thuộc tính, không trùng nhau. Trả về thông báo lỗi hoặc null. */
export function validateVariants(input: ProductInput): string | null {
  const attrNames = input.attributes.map((a) => a.name);
  if (new Set(attrNames.map(normalizeText)).size !== attrNames.length) return 'Tên thuộc tính bị trùng';
  for (const a of input.attributes) {
    if (new Set(a.values.map(normalizeText)).size !== a.values.length) return `Giá trị của "${a.name}" bị trùng`;
  }
  if (input.attributes.length === 0) {
    if (input.variants.length !== 1 || Object.keys(input.variants[0].options).length) return 'Sản phẩm không phân loại chỉ có 1 dòng tồn kho';
    return null;
  }
  const seen = new Set<string>();
  for (const v of input.variants) {
    const keys = Object.keys(v.options);
    if (keys.length !== attrNames.length || !attrNames.every((n) => keys.includes(n))) return 'Phân loại thiếu thuộc tính';
    for (const a of input.attributes) {
      if (!a.values.includes(v.options[a.name])) return `Giá trị "${v.options[a.name]}" không có trong "${a.name}"`;
    }
    const key = attrNames.map((n) => normalizeText(v.options[n])).join('|');
    if (seen.has(key)) return `Phân loại "${variantLabel(v.options)}" bị trùng`;
    seen.add(key);
  }
  return null;
}

function productDTO(p: { variants: { stock: number; reserved: number; options: unknown }[] } & Record<string, unknown>) {
  return {
    ...p,
    variants: p.variants.map((v) => ({ ...v, label: variantLabel(v.options), available: Math.max(0, v.stock - v.reserved) })),
  };
}

export function productRoutes(app: FastifyInstance, db: DB, sales: OrderService) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/products', async (req) => {
    const q = req.query as { all?: string };
    const list = await db.product.findMany({
      where: { shopId: req.user.shopId, ...(q.all ? {} : { active: true }) },
      orderBy: { createdAt: 'desc' },
      include: { variants: { orderBy: { sortOrder: 'asc' } } },
    });
    return list.map(productDTO);
  });

  app.post('/api/products', async (req, reply) => {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const err = validateVariants(parsed.data);
    if (err) return reply.code(400).send({ error: err });
    const d = parsed.data;
    const p = await db.product.create({
      data: {
        shopId: req.user.shopId,
        name: d.name,
        description: d.description || null,
        imageUrl: d.imageUrl || null,
        price: d.price,
        attributes: d.attributes,
        variants: {
          create: d.variants.map((v, i) => ({ options: v.options, sku: v.sku || null, price: v.price ?? null, stock: v.stock, sortOrder: i })),
        },
      },
      include: { variants: { orderBy: { sortOrder: 'asc' } } },
    });
    return productDTO(p);
  });

  app.put('/api/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const err = validateVariants(parsed.data);
    if (err) return reply.code(400).send({ error: err });
    const existing = await db.product.findFirst({ where: { id, shopId: req.user.shopId }, include: { variants: true } });
    if (!existing) return reply.code(404).send({ error: 'Không tìm thấy sản phẩm' });
    const d = parsed.data;

    const keepIds = new Set(d.variants.map((v) => v.id).filter(Boolean) as string[]);
    const removed = existing.variants.filter((v) => !keepIds.has(v.id));
    for (const v of removed) {
      const busy = await db.orderItem.count({
        where: { variantId: v.id, status: { in: ['RESERVED', 'WAITLIST'] }, order: { status: { in: ACTIVE_ORDER } } },
      });
      if (busy > 0 || v.reserved > 0) {
        return reply.code(409).send({ error: `Phân loại "${variantLabel(v.options) ?? 'mặc định'}" đang có đơn giữ hàng, không xoá được` });
      }
    }
    const increased: string[] = [];
    await db.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { name: d.name, description: d.description || null, imageUrl: d.imageUrl || null, price: d.price, attributes: d.attributes },
      });
      if (removed.length) await tx.productVariant.deleteMany({ where: { id: { in: removed.map((v) => v.id) } } });
      for (const [i, v] of d.variants.entries()) {
        const old = v.id ? existing.variants.find((x) => x.id === v.id) : undefined;
        if (old) {
          if (v.stock > old.stock) increased.push(old.id);
          await tx.productVariant.update({
            where: { id: old.id },
            data: { options: v.options, sku: v.sku || null, price: v.price ?? null, stock: v.stock, sortOrder: i },
          });
        } else {
          await tx.productVariant.create({
            data: { productId: id, options: v.options, sku: v.sku || null, price: v.price ?? null, stock: v.stock, sortOrder: i },
          });
        }
      }
    });
    sales.invalidateAll();
    // Tăng tồn kho -> chuyển khách đang chờ sang giữ hàng
    for (const vid of increased) await sales.promoteWaitlist(vid);
    const p = await db.product.findUniqueOrThrow({ where: { id }, include: { variants: { orderBy: { sortOrder: 'asc' } } } });
    return productDTO(p);
  });

  app.delete('/api/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await db.product.findFirst({ where: { id, shopId: req.user.shopId } });
    if (!p) return reply.code(404).send({ error: 'Không tìm thấy sản phẩm' });
    const used = await db.sessionProduct.count({ where: { productId: id } });
    if (used > 0) {
      // Đã dùng trong phiên live: chỉ ẩn khỏi kho để giữ lịch sử đơn hàng
      await db.product.update({ where: { id }, data: { active: false } });
      return { ok: true, archived: true };
    }
    await db.product.delete({ where: { id } });
    return { ok: true, archived: false };
  });

  app.post('/api/products/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await db.product.findFirst({ where: { id, shopId: req.user.shopId } });
    if (!p) return reply.code(404).send({ error: 'Không tìm thấy sản phẩm' });
    await db.product.update({ where: { id }, data: { active: true } });
    return { ok: true };
  });
}
