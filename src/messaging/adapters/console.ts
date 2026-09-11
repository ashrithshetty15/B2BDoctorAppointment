import crypto from 'node:crypto';
import { logger } from '../../utils/logger';
import type {
  InboundMessage,
  MessagingAdapter,
  OutboundMessage,
  SendResult,
  WebhookVerification,
} from '../types';

/**
 * Local-development adapter. Outbound messages are logged instead of sent, and
 * inbound accepts a hand-rolled payload so the whole flow can be exercised with
 * curl and no Meta account:
 *
 *   curl -X POST localhost:3000/webhook \
 *     -H 'content-type: application/json' \
 *     -d '{"from":"919876543210","text":"hi","channelAddress":"test-number"}'
 *
 * Also used by tests to assert on what the state machine decided to send.
 */
export class ConsoleAdapter implements MessagingAdapter {
  readonly name = 'console';

  /** Everything sent in this process, newest last. Handy in tests. */
  readonly sent: OutboundMessage[] = [];

  verifyWebhook(query: Record<string, unknown>): WebhookVerification {
    const challenge = query['hub.challenge'];
    return { ok: true, challenge: challenge === undefined ? 'ok' : String(challenge) };
  }

  verifySignature(): boolean {
    return true;
  }

  parseInbound(body: unknown): InboundMessage[] {
    const b = body as {
      from?: string;
      text?: string;
      channelAddress?: string;
      providerMessageId?: string;
      senderName?: string;
    };
    if (!b?.from || typeof b.text !== 'string') return [];

    return [
      {
        providerMessageId: b.providerMessageId ?? crypto.randomUUID(),
        from: b.from.replace(/\D/g, ''),
        channelAddress: b.channelAddress ?? 'console',
        text: b.text.trim(),
        ...(b.senderName ? { senderName: b.senderName } : {}),
        receivedAt: new Date(),
        raw: b,
      },
    ];
  }

  async sendText(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message);
    logger.info({ to: message.to }, `[outbound]\n${message.text}`);
    return { providerMessageId: crypto.randomUUID() };
  }
}
