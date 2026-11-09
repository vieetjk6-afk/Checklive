import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { requireAuth } from '../auth.js';
import { buildVietQrPayload } from '../sales/vietqr.js';

const shopSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên shop').max(100),
  bankBin: z.string().trim().regex(/^\d{6}$/, 'Mã BIN ngân hàng gồm 6 chữ số').nullable().or(z.literal('')),
  bankAccountNo: z.string().trim().regex(/^[0-9A-Za-z]{4,19}$/, 'Số tài khoản không hợp lệ').nullable().or(z.literal('')),
  bankAccountName: z.string().trim().max(100).nullable().or(z.literal('')),
  defaultHoldMinutes: z.number().int().min(5).max(60 * 24 * 30).nullable(),
});

export function shopRoutes(app: FastifyInstance, db: DB) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/shop', async (req) => {
    const s = await db.shop.findUniqueOrThrow({ where: { id: req.user.shopId } });
    return { name: s.name, bankBin: s.bankBin, bankAccountNo: s.bankAccountNo, bankAccountName: s.bankAccountName, defaultHoldMinutes: s.defaultHoldMinutes };
  });

  app.put('/api/shop', async (req, reply) => {
    const parsed = shopSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const d = parsed.data;
    const hasBank = !!(d.bankBin && d.bankAccountNo);
    if ((d.bankBin || d.bankAccountNo) && !hasBank) return reply.code(400).send({ error: 'Cần nhập đủ ngân hàng và số tài khoản' });
    await db.shop.update({
      where: { id: req.user.shopId },
      data: {
        name: d.name,
        bankBin: d.bankBin || null,
        bankAccountNo: d.bankAccountNo || null,
        bankAccountName: d.bankAccountName ? d.bankAccountName.toUpperCase() : null,
        defaultHoldMinutes: d.defaultHoldMinutes,
      },
    });
    return { ok: true };
  });

  /** Mã QR thử để kiểm tra bằng app ngân hàng */
  app.get('/api/shop/test-qr', async (req, reply) => {
    const s = await db.shop.findUniqueOrThrow({ where: { id: req.user.shopId } });
    if (!s.bankBin || !s.bankAccountNo) return reply.code(400).send({ error: 'Chưa cài đặt tài khoản ngân hàng' });
    return { payload: buildVietQrPayload({ bin: s.bankBin, accountNo: s.bankAccountNo, amount: 10000, note: 'Thu QR Checklive' }) };
  });
}
