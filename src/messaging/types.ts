/**
 * Provider-neutral messaging contract (requirement 8).
 *
 * The conversation state machine imports ONLY from this file. Nothing below
 * mentions Meta, Gupshup or Interakt, so swapping the BSP means writing one new
 * adapter in ./adapters and changing MESSAGING_PROVIDER — no state machine edits.
 */

/** A normalised inbound patient message. */
export interface InboundMessage {
  /** Provider's own message id — used for idempotent webhook handling. */
  providerMessageId: string;
  /** Patient's phone, digits only, E.164 without '+' (e.g. 919876543210). */
  from: string;
  /**
   * The address the patient messaged — for WhatsApp Cloud this is Meta's
   * `phone_number_id`. Used to resolve which Doctor owns the conversation.
   */
  channelAddress: string;
  /**
   * Flattened user intent as text. Interactive replies (buttons, list rows) are
   * normalised to their payload/title so the state machine only ever reads text.
   */
  text: string;
  /** Display name the provider reports for the sender, if any. */
  senderName?: string;
  receivedAt: Date;
  /** Original provider payload, for logging/debugging only. */
  raw?: unknown;
}

/** A message the state machine wants delivered to a patient. */
export interface OutboundMessage {
  /** Patient's phone, digits only. */
  to: string;
  text: string;
  /** Sender address to use (Meta `phone_number_id`). Falls back to env default. */
  channelAddress?: string;
}

export interface SendResult {
  providerMessageId?: string;
}

/** Result of a provider webhook GET verification handshake. */
export interface WebhookVerification {
  ok: boolean;
  /** Echo value the provider expects in the response body. */
  challenge?: string;
}

export interface MessagingAdapter {
  readonly name: string;

  /** Handle the provider's subscription handshake (Meta: hub.challenge). */
  verifyWebhook(query: Record<string, unknown>): WebhookVerification;

  /**
   * Verify payload authenticity. `rawBody` must be the unparsed request body.
   * Returns true when the adapter has no signature scheme configured.
   */
  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;

  /**
   * Extract zero or more patient messages from a webhook payload. Status
   * callbacks (delivered/read) and other noise yield an empty array.
   */
  parseInbound(body: unknown): InboundMessage[];

  sendText(message: OutboundMessage): Promise<SendResult>;
}
