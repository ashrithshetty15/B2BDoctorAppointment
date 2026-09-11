import { env } from './config/env';
import { prisma } from './db/prisma';
import { createApp } from './http/app';
import { closeQueues } from './queue/queues';
import { closeRedis } from './queue/connection';
import { logger } from './utils/logger';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, provider: env.MESSAGING_PROVIDER, env: env.NODE_ENV },
    'API listening',
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down API');

  server.close();
  await closeQueues().catch(() => undefined);
  await closeRedis().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
