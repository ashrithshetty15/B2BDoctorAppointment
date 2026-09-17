import crypto from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  MAX_REPLY_BUTTONS,
  type InboundMessage,
  type MessagingAdapter,
  type OutboundMessage,
  type SendResult,
  type TemplateMessage,
  type WebhookVerification,
} from '../types';

/** Shapes we care about from Meta's webhook payload. Everything else is ignored. */
interface CloudApiMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}

interface CloudApiValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: CloudApiMessage[];
  statuses?: unknown[];
}

interface CloudApiPayload {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: CloudApiValue }> }>;
}

export class WhatsAppCloudAdapter implements MessagingAdapter {
  readonly name = 'whatsapp_cloud';

  verifyWebhook(query: Record<string, unknown>): WebhookVerification {
    const mode = String(query['hub.mode'] ?? '');
    const token = String(query['hub.verify_token'] ?? '');
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      return { ok: true, challenge: challenge === undefined ? '' : String(challenge) };
    }
    return { ok: false };
  }

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const secret = env.WHATSAPP_APP_SECRET;
    if (!secret) {
      // No app secret configured — dev mode. Loud enough to notice in logs.
      logger.warn('WHATSAPP_APP_SECRET not set; skipping webhook signature verification');
      return true;
    }

    const header = headers['x-hub-signature-256'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || !provided.startsWith('sha256=')) return false;

    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseInbound(body: unknown): InboundMessage[] {
    const payload = body as CloudApiPayload;
    if (!payload || payload.object !== 'whatsapp_business_account') return [];

    const out: InboundMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        // Delivery/read receipts carry `statuses`, not `messages`.
        if (!value.messages?.length) continue;

        const channelAddress = value.metadata?.phone_number_id ?? '';
        const contactName = value.contacts?.[0]?.profile?.name;

        for (const msg of value.messages) {
          const text = extractText(msg);
          if (text === null) {
            logger.debug({ type: msg.type }, 'Ignoring unsupported inbound message type');
            continue;
          }
          if (!msg.id || !msg.from) continue;

          out.push({
            providerMessageId: msg.id,
            from: normalisePhone(msg.from),
            channelAddress,
            text,
            ...(contactName ? { senderName: contactName } : {}),
            receivedAt: msg.timestamp
              ? new Date(Number(msg.timestamp) * 1000)
              : new Date(),
            raw: msg,
          });
        }
      }
    }

    return out;
  }

  async sendText(message: OutboundMessage): Promise<SendResult> {
    const phoneNumberId = message.channelAddress ?? env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      throw new Error('No WhatsApp phone_number_id available to send from');
    }

    const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: message.to,
        ...interactiveOrText(message),
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      // Thrown so BullMQ retries with backoff.
      throw new Error(`WhatsApp send failed (${res.status}): ${bodyText}`);
    }

    let providerMessageId: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { messages?: Array<{ id?: string }> };
      providerMessageId = parsed.messages?.[0]?.id;
    } catch {
      // Non-JSON success body — nothing to extract.
    }

    return providerMessageId ? { providerMessageId } : {};
  }

  async sendTemplate(message: TemplateMessage): Promise<SendResult> {
    const phoneNumberId = message.channelAddress ?? env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      throw new Error('No WhatsApp phone_number_id available to send from');
    }

    const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'template',
        template: {
          name: message.templateName,
          language: { code: message.languageCode ?? 'en_US' },
          ...(message.params && message.params.length > 0
            ? {
                body: {
                  parameters: message.params.map((v) => ({ type: 'text', text: v })),
                },
              }
            : {}),
        },
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`WhatsApp template send failed (${res.status}): ${bodyText}`);
    }

    let providerMessageId: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { messages?: Array<{ id?: string }> };
      providerMessageId = parsed.messages?.[0]?.id;
    } catch {
      // Non-JSON success body — nothing to extract.
    }

    return providerMessageId ? { providerMessageId } : {};
  }
}

/**
 * Collapse every supported message type to plain text. Returns null for types
 * the bot cannot act on (images, location, audio, ...).
 */
/**
 * Meta caps a button title; anything longer is rejected outright rather than
 * truncated, which would fail the whole send. Trimming here means a long
 * translation degrades to a clipped label instead of no message at all.
 */
const BUTTON_TITLE_MAX = 20;

/**
 * Render as interactive reply buttons when the caller supplied them, otherwise
 * as plain text.
 *
 * The body keeps the full numbered text either way, so the message still reads
 * correctly if a client does not render buttons, and typing "1" keeps working —
 * inbound button taps arrive as the button's id, which is that same token.
 */
function interactiveOrText(message: OutboundMessage): Record<string, unknown> {
  const buttons = message.buttons?.slice(0, MAX_REPLY_BUTTONS) ?? [];
  if (buttons.length === 0) {
    return { type: 'text', text: { preview_url: false, body: message.text } };
  }

  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: message.text },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, BUTTON_TITLE_MAX) },
        })),
      },
    },
  };
}

function extractText(msg: CloudApiMessage): string | null {
  switch (msg.type) {
    case 'text':
      return msg.text?.body?.trim() ?? '';
    case 'button':
      // Quick-reply from a template message.
      return (msg.button?.payload ?? msg.button?.text ?? '').trim();
    case 'interactive': {
      const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      return (reply?.id ?? reply?.title ?? '').trim();
    }
    default:
      return null;
  }
}

function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}
