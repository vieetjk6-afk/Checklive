import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { DB } from './db.js';

export const COOKIE_NAME = 'cl_token';

export interface AuthUser {
  uid: string;
  shopId: string;
  role: 'OWNER' | 'STAFF';
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

/** Lần chạy đầu: tạo shop mặc định và tài khoản quản trị từ biến môi trường. */
export async function ensureAdmin(db: DB, config: Config): Promise<void> {
  const count = await db.user.count();
  if (count > 0) return;
  const shop = (await db.shop.findFirst()) ?? (await db.shop.create({ data: { name: 'Shop của tôi' } }));
  await db.user.create({
    data: {
      shopId: shop.id,
      email: config.ADMIN_EMAIL.toLowerCase(),
      name: 'Quản trị',
      passwordHash: await bcrypt.hash(config.ADMIN_PASSWORD, 10),
      role: 'OWNER',
    },
  });
  console.log(`Đã tạo tài khoản quản trị: ${config.ADMIN_EMAIL}`);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Chưa đăng nhập' });
  }
}

export function authRoutes(app: FastifyInstance, db: DB, config: Config) {
  const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

  app.post('/api/auth/login', async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Email hoặc mật khẩu không hợp lệ' });
    const user = await db.user.findUnique({ where: { email: body.data.email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(body.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Sai email hoặc mật khẩu' });
    }
    const token = app.jwt.sign({ uid: user.id, shopId: user.shopId, role: user.role }, { expiresIn: '30d' });
    reply.setCookie(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: 30 * 24 * 3600,
    });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  /** Đổi mật khẩu (cần nhập mật khẩu hiện tại) */
  app.post('/api/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = z.object({ current: z.string().min(1), next: z.string().min(8, 'Mật khẩu mới cần ít nhất 8 ký tự').max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ' });
    const user = await db.user.findUnique({ where: { id: req.user.uid } });
    if (!user || !(await bcrypt.compare(body.data.current, user.passwordHash))) {
      return reply.code(400).send({ error: 'Mật khẩu hiện tại không đúng' });
    }
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.data.next, 10) } });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await db.user.findUnique({ where: { id: req.user.uid } });
    if (!user) return reply.code(401).send({ error: 'Chưa đăng nhập' });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  });
}
