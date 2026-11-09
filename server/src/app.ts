import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { COOKIE_NAME, authRoutes, ensureAdmin, type AuthUser } from './auth.js';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { createAdapterFactory, type AdapterFactory } from './adapters/index.js';
import { SessionManager, type Broadcaster } from './live/sessionManager.js';
import { channelRoutes } from './routes/channels.js';
import { sessionRoutes } from './routes/sessions.js';

export interface BuiltApp {
  app: FastifyInstance;
  io: SocketServer;
  manager: SessionManager;
}

export async function buildApp(config: Config, db: DB, opts: { adapterFactory?: AdapterFactory; logger?: boolean } = {}): Promise<BuiltApp> {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });

  await app.register(cookie);
  await app.register(jwt, { secret: config.JWT_SECRET, cookie: { cookieName: COOKIE_NAME, signed: false } });

  const io = new SocketServer(app.server, { path: '/socket.io', serveClient: false });

  const broadcaster: Broadcaster = {
    toSession: (sessionId, event, payload) => io.to(`s:${sessionId}`).emit(event, payload),
  };
  const manager = new SessionManager(
    db,
    broadcaster,
    opts.adapterFactory ?? createAdapterFactory({ eulerApiKey: config.EULER_API_KEY, fbGraphVersion: config.FB_GRAPH_VERSION }),
  );

  // Xác thực Socket.IO bằng cookie đăng nhập
  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie ?? '';
      const token = app.parseCookie(raw)[COOKIE_NAME];
      if (!token) return next(new Error('unauthorized'));
      socket.data.user = app.jwt.verify<AuthUser>(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join', async (sessionId: string, ack?: (r: unknown) => void) => {
      const user = socket.data.user as AuthUser;
      const s = await db.liveSession.findFirst({ where: { id: sessionId, shopId: user.shopId }, select: { id: true } });
      if (!s) return ack?.({ ok: false });
      for (const room of socket.rooms) if (room.startsWith('s:')) socket.leave(room);
      socket.join(`s:${sessionId}`);
      ack?.({ ok: true, state: manager.channelStates(sessionId) ?? [], stats: manager.snapshot(sessionId) ?? null });
    });
    socket.on('leave', (sessionId: string) => socket.leave(`s:${sessionId}`));
  });

  app.get('/api/health', async () => ({ ok: true }));
  authRoutes(app, db, config);
  await app.register(async (scope) => channelRoutes(scope, db, config));
  await app.register(async (scope) => sessionRoutes(scope, db, manager));

  // Phục vụ giao diện web đã build (nếu có)
  const webDist = config.WEB_DIST ?? path.resolve(process.cwd(), '../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
        return reply.code(404).send({ error: 'Không tìm thấy' });
      }
      return reply.sendFile('index.html');
    });
  }

  await ensureAdmin(db, config);

  app.addHook('onClose', async () => {
    await manager.shutdown();
    io.close();
  });

  return { app, io, manager };
}
