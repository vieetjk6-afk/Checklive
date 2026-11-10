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
import { productRoutes } from './routes/products.js';
import { salesRoutes } from './routes/sales.js';
import { publicRoutes } from './routes/public.js';
import { shopRoutes } from './routes/shop.js';
import { OrderService } from './sales/orderService.js';
import { GameService } from './games/gameService.js';
import { gameRoutes } from './routes/games.js';
import { extensionRoutes } from './routes/extension.js';
import { ExtensionAdapter, ExtensionHub } from './adapters/extension.js';

export interface BuiltApp {
  app: FastifyInstance;
  io: SocketServer;
  manager: SessionManager;
  sales: OrderService;
  games: GameService;
}

export async function buildApp(
  config: Config,
  db: DB,
  opts: { adapterFactory?: AdapterFactory; logger?: boolean; expiryIntervalMs?: number } = {},
): Promise<BuiltApp> {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });

  await app.register(cookie);
  await app.register(jwt, { secret: config.JWT_SECRET, cookie: { cookieName: COOKIE_NAME, signed: false } });

  const io = new SocketServer(app.server, { path: '/socket.io', serveClient: false });

  const broadcaster: Broadcaster = {
    toSession: (sessionId, event, payload) => io.to(`s:${sessionId}`).emit(event, payload),
  };
  // Gửi danh sách sản phẩm phiên (tồn kho còn lại) — gom lại tối đa 2 lần/giây mỗi phiên
  const productTimers = new Map<string, NodeJS.Timeout>();
  let sales!: OrderService;
  const productsChanged = (sessionId: string) => {
    if (productTimers.has(sessionId)) return;
    productTimers.set(
      sessionId,
      setTimeout(async () => {
        productTimers.delete(sessionId);
        try {
          broadcaster.toSession(sessionId, 'products', await sales.sessionProducts(sessionId));
        } catch (err) {
          app.log.error(err);
        }
      }, 500),
    );
  };
  sales = new OrderService(db, {
    order: (sessionId, order) => broadcaster.toSession(sessionId, 'order', order),
    productsChanged,
  });

  // Kênh qua tiện ích Chrome luôn nhận dữ liệu qua hub (kể cả khi test thay adapter khác)
  const extensionHub = new ExtensionHub();
  const baseFactory: AdapterFactory =
    opts.adapterFactory ?? createAdapterFactory({ eulerApiKey: config.EULER_API_KEY, fbGraphVersion: config.FB_GRAPH_VERSION, extensionHub });
  const adapterFactory: AdapterFactory = (ch, cb) =>
    ch.connector === 'EXTENSION' ? new ExtensionAdapter(ch.id, cb, extensionHub) : baseFactory(ch, cb);

  const manager = new SessionManager(db, broadcaster, adapterFactory, sales);
  const games = new GameService(db, (sid, platform, uid) => manager.userActivity(sid, platform, uid), {
    game: (sessionId, game) => broadcaster.toSession(sessionId, 'game', game),
    answer: (sessionId, payload) => broadcaster.toSession(sessionId, 'gameAnswer', payload),
  });
  manager.setGames(games);
  await games.recover();

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
  await app.register(async (scope) => channelRoutes(scope, db, config, extensionHub));
  await app.register(async (scope) => sessionRoutes(scope, db, manager));
  await app.register(async (scope) => productRoutes(scope, db, sales));
  await app.register(async (scope) => salesRoutes(scope, db, sales, productsChanged));
  await app.register(async (scope) => shopRoutes(scope, db));
  await app.register(async (scope) => gameRoutes(scope, db, games));
  await app.register(async (scope) =>
    extensionRoutes(scope, db, extensionHub, config.EXTENSION_DIR ?? path.resolve(process.cwd(), '../extension')),
  );
  await app.register(async (scope) => publicRoutes(scope, db, sales, games));

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

  // Huỷ đơn quá hạn giữ hàng (định kỳ)
  const expiryTimer = setInterval(() => {
    sales.expireDue().catch((err) => app.log.error(err));
  }, opts.expiryIntervalMs ?? 30_000);

  app.addHook('onClose', async () => {
    clearInterval(expiryTimer);
    games.shutdown();
    for (const t of productTimers.values()) clearTimeout(t);
    await manager.shutdown();
    io.close();
  });

  return { app, io, manager, sales, games };
}
