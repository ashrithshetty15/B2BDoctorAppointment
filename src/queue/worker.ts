import { Worker } from 'bullmq';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { createRedisConnection } from './connection';
import { processOutbound } from './jobs/outbound';
import { processReminder } from './jobs/reminders';
import { processTokenEvent } from './jobs/tokenEvents';
import {
  QUEUE_OUTBOUND,
  QUEUE_REMINDERS,
  QUEUE_TOKEN_EVENTS,
  closeQueues,
  registerReminderSweep,
  type OutboundJob,
  type ReminderJob,
  type TokenEventJob,
} from './queues';

/**
 * Worker process. Runs alongside the API in the same container for the MVP
 * (see docker-entrypoint.sh); split it out by setting PROCESS=worker on a second
 * container when volume justifies it.
 */

const workers = [
  new Worker<OutboundJob>(QUEUE_OUTBOUND, processOutbound, {
    connection: createRedisConnection(),
    // Meta's per-number throughput is generous but not unlimited; keep sends
    // orderly and well under any rate limit.
    concurrency: 5,
    limiter: { max: 20, duration: 1000 },
  }),

  new Worker<TokenEventJob>(QUEUE_TOKEN_EVENTS, processTokenEvent, {
    connection: createRedisConnection(),
    // Serialised per process: two concurrent recalcs for the same doctor would
    // race on lastNotifiedPosition.
    concurrency: 1,
  }),

  new Worker<ReminderJob>(QUEUE_REMINDERS, processReminder, {
    connection: createRedisConnection(),
    concurrency: 2,
  }),
];

for (const worker of workers) {
  worker.on('failed', (job, err) => {
    logger.error(
      { queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade, err },
      'Job failed',
    );
  });
  worker.on('error', (err) => {
    logger.error({ queue: worker.name, err }, 'Worker error');
  });
}

registerReminderSweep()
  .then(() => logger.info('Reminder sweep scheduled (every 10 minutes)'))
  .catch((err) => logger.error({ err }, 'Failed to register reminder sweep'));

logger.info(
  { queues: workers.map((w) => w.name) },
  'Worker started',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker shutting down');
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
