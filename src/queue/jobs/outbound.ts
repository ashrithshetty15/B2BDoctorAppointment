import type { Job } from 'bullmq';
import { getMessagingAdapter } from '../../messaging';
import { logger } from '../../utils/logger';
import type { OutboundJob } from '../queues';

/**
 * The ONE place a messaging provider is actually invoked. Everything upstream
 * deals in text + phone number, which is what makes swapping the BSP a
 * single-adapter change.
 *
 * Throwing here is intentional: BullMQ retries with exponential backoff, which
 * is what you want against Meta's rate limits and transient 5xx.
 */
export async function processOutbound(job: Job<OutboundJob>): Promise<void> {
  const adapter = getMessagingAdapter();
  const { to, text, channelAddress, templateName } = job.data;

  const result = await adapter.sendText({
    to,
    text,
    ...(channelAddress ? { channelAddress } : {}),
  });

  logger.info(
    {
      to,
      templateName,
      provider: adapter.name,
      providerMessageId: result.providerMessageId,
      attempt: job.attemptsMade + 1,
    },
    'Outbound message sent',
  );
}
