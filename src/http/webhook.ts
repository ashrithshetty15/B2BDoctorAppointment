import { Router, type Request } from 'express';
import { handleInboundMessage } from '../conversation/engine';
import { getMessagingAdapter } from '../messaging';
import { logger } from '../utils/logger';

/**
 * Provider webhook. Deliberately thin: verify, parse via the adapter, hand each
 * message to the conversation engine. No Meta-specific logic lives beyond the
 * adapter, and no patient-facing copy lives here at all.
 */
export const webhookRouter = Router();

/** Meta's subscription handshake. */
webhookRouter.get('/webhook', (req, res) => {
  const verification = getMessagingAdapter().verifyWebhook(
    req.query as Record<string, unknown>,
  );

  if (!verification.ok) {
    logger.warn('Webhook verification failed (verify token mismatch)');
    res.sendStatus(403);
    return;
  }

  res.status(200).send(verification.challenge ?? '');
});

webhookRouter.post('/webhook', async (req, res) => {
  const adapter = getMessagingAdapter();
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');

  if (!adapter.verifySignature(rawBody, req.headers)) {
    logger.warn('Rejected webhook payload: signature verification failed');
    res.sendStatus(401);
    return;
  }

  // Delivery receipts, before anything else. The provider can accept a send,
  // return a message id, and never deliver it — these are the only place that
  // shows up, and without them a silently undelivered reply is indistinguishable
  // from a working one.
  if (adapter.parseStatuses) {
    try {
      for (const s of adapter.parseStatuses(req.body)) {
        if (s.status === 'failed') {
          logger.warn(
            {
              providerMessageId: s.providerMessageId,
              recipient: s.recipient,
              channelAddress: s.channelAddress,
              errors: s.errors,
            },
            'Outbound message was not delivered',
          );
        } else {
          logger.debug(
            { providerMessageId: s.providerMessageId, status: s.status },
            'Delivery receipt',
          );
        }
      }
    } catch (err) {
      // A receipt we cannot read must never cost us the message in the same
      // payload, nor make Meta retry the whole thing.
      logger.warn({ err }, 'Failed to parse delivery receipts');
    }
  }

  let messages: ReturnType<typeof adapter.parseInbound> = [];
  try {
    messages = adapter.parseInbound(req.body);
  } catch (err) {
    logger.error({ err }, 'Failed to parse webhook payload');
    // 200 anyway: a malformed payload will never parse, and a non-2xx makes
    // Meta retry it forever.
    res.sendStatus(200);
    return;
  }

  if (!messages.length) {
    res.sendStatus(200);
    return;
  }

  try {
    // Sequential: two messages from the same patient must not race on session
    // state. Volumes here are one patient's messages per request.
    for (const message of messages) {
      const result = await handleInboundMessage(message);
      logger.debug(
        { from: message.from, handled: result.handled, reason: result.reason },
        'Inbound message processed',
      );
    }
    res.sendStatus(200);
  } catch (err) {
    // Engine-level failure — 500 so Meta retries; the engine's own dedupe
    // record is only written on success, so a retry is safe.
    logger.error({ err }, 'Unhandled error while processing inbound messages');
    res.sendStatus(500);
  }
});
