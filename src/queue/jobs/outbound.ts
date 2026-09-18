import type { Job } from 'bullmq';
import { clearSendFailure, recordSendFailure } from '../../domain/channelHealth';
import { getMessagingAdapter } from '../../messaging';
import { isAuthorizationFailure } from '../../messaging/sendError';
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
  const { to, text, buttons, list, channelAddress, templateName } = job.data;

  let result;
  try {
    result = await adapter.sendText({
      to,
      text,
      ...(channelAddress ? { channelAddress } : {}),
      ...(buttons?.length ? { buttons } : {}),
      ...(list?.rows.length ? { list } : {}),
    });
  } catch (err) {
    // A refusal on permission grounds is not something backoff will outlast, and
    // it is invisible everywhere else: the provider's own health endpoint went
    // on reporting this account AVAILABLE while rejecting every message. Record
    // it against the clinic so the console says so, then rethrow — the retry
    // behaviour is deliberately unchanged, since the grant may well come back.
    if (isAuthorizationFailure(err)) {
      await recordSendFailure(err.channelAddress, err.message, err.code).catch((recordErr) => {
        // Never let bookkeeping swallow the original failure.
        logger.warn({ err: recordErr }, 'Could not record channel send failure');
      });
    }
    throw err;
  }

  // Proof the channel works, and the only thing allowed to clear a block that a
  // send established.
  if (channelAddress) {
    await clearSendFailure(channelAddress).catch((err) => {
      logger.warn({ err }, 'Could not clear channel send failure');
    });
  }

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
