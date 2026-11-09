import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';

async function main() {
  const config = loadConfig();
  const { app, manager } = await buildApp(config, prisma);
  await app.listen({ port: config.PORT, host: config.HOST });
  await manager.resumeRunning();

  const shutdown = async (signal: string) => {
    app.log.info(`Nhận ${signal}, đang lưu dữ liệu và tắt…`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
