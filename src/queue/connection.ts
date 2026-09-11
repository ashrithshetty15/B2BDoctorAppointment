import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connection, otherwise
 * blocking commands (BRPOPLPUSH) are aborted by ioredis' retry logic.
 */
export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

let shared: IORedis | null = null;

/** Shared connection for producers (queues). Workers get their own. */
export function getRedis(): IORedis {
  if (!shared) shared = createRedisConnection();
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}
