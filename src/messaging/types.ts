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
/**
 * One tappable reply button.
 *
 * `id` is what comes back on tap — extractText normalises an inbound
 * button_reply to exactly this value. Setting it to the same token the text
 * flow expects ("1", "2") means the state machine needs no knowledge of
 * buttons at all, and typing still works for anyone whose client does not
 * render them.
 */
export interface ReplyButton {
  /** Meta caps this at 256 chars; we use short flow tokens. */
  id: string;
  /** Shown on the button. Meta truncates past ~20 characters. */
  title: string;
}

/** Meta allows at most three reply buttons on one message. */
export const MAX_REPLY_BUTTONS = 3;

/**
 * One row of an interactive list. Same contract as a button: `id` is what comes
 * back on selection, so it is the token the typed flow already accepts.
 */
export interface ListRow {
  id: string;
  /** Meta truncates past ~24 characters. */
  title: string;
  /** Optional second line, ~72 characters. */
  description?: string;
}

/**
 * Meta allows at most ten rows across all sections of one list — the reason the
 * slot picker has to page rather than render a whole morning of times.
 */
export const MAX_LIST_ROWS = 10;

export interface OutboundMessage {
  /** Patient's phone, digits only. */
  to: string;
  text: string;
  /** Sender address to use (Meta `phone_number_id`). Falls back to env default. */
  channelAddress?: string;
  /**
   * Render as tappable buttons instead of plain text. The text is still sent as
   * the message body, so the numbered list remains readable and a patient can
   * always type the number instead.
   */
  buttons?: ReplyButton[];
  /**
   * Render as an interactive list instead. Used where there are more options
   * than buttons allow — picking an appointment time, for instance. Mutually
   * exclusive with `buttons`; buttons win if both are somehow set.
   */
  list?: {
    /** Label on the button that opens the list, e.g. "Choose a time". */
    buttonText: string;
    rows: ListRow[];
  };
}

export interface SendResult {
  providerMessageId?: string;
}

/** A template message for business-initiated conversations (e.g., missed-call replies). */
export interface TemplateMessage {
  to: string;
  templateName: string;
  params?: string[];
  channelAddress?: string;
  /**
   * Meta language code for the approved template, e.g. 'en_US' or 'kn'.
   *
   * A template is approved per language, so this has to match one that exists or
   * Meta rejects the send. Defaults to en_US, which is what the missed-call
   * auto-reply relied on before this was configurable.
   */
  languageCode?: string;
}

/** Result of a provider webhook GET verification handshake. */
export interface WebhookVerification {
  ok: boolean;
  /** Echo value the provider expects in the response body. */
  challenge?: string;
}

/**
 * Whether a clinic's channel can actually deliver messages right now.
 *
 * Normalised across providers so the console does not learn Meta's vocabulary —
 * the same reason sendText is on this interface rather than the adapter being
 * reached into directly.
 */
export type ChannelStatus = 'AVAILABLE' | 'LIMITED' | 'BLOCKED' | 'UNKNOWN';

export interface ChannelHealth {
  /** Rollup. LIMITED still delivers; BLOCKED does not. */
  status: ChannelStatus;
  /**
   * Why, in the provider's words. Deliberately the *blocking entity's* message
   * rather than the rollup's: a number can report LIMITED while the account
   * above it is BLOCKED on billing, and the account is the actionable part.
   */
  reason?: string;
  /** Provider error code, for a support ticket. */
  code?: number;
  /** Which layer is at fault — the number, the account, the app. */
  entity?: string;
  /** What the provider suggests doing about it. */
  solution?: string;
}

/**
 * What became of a message we sent.
 *
 * `failed` is the one that matters and the one the product was blind to: Meta
 * returns a message id for a send it will never deliver, so "accepted" and
 * "arrived" are different facts and only this reports the second.
 */
export interface MessageStatus {
  providerMessageId: string;
  /** sent | delivered | read | failed, plus anything new the provider adds. */
  status: string;
  /** The recipient, as the provider identifies them. */
  recipient?: string;
  /** Which of our numbers it was sent from. */
  channelAddress?: string;
  errors?: Array<{ code?: number; title?: string; details?: string }>;
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

  /**
   * Extract delivery receipts from a webhook payload.
   *
   * Optional, because not every provider reports them — but where one does,
   * this is the only place a *delivery* failure is visible. The send API can
   * accept a message, return an id, and the message still never arrive; without
   * these the product cannot tell that apart from success.
   */
  parseStatuses?(body: unknown): MessageStatus[];

  sendText(message: OutboundMessage): Promise<SendResult>;

  /** Send a pre-approved template message (business-initiated, e.g., missed-call reply). */
  sendTemplate?(message: TemplateMessage): Promise<SendResult>;

  /**
   * Can this channel deliver right now, and if not, why?
   *
   * Optional: a provider that cannot report health simply has none, and the
   * console shows UNKNOWN rather than pretending everything is fine.
   */
  getChannelHealth?(channelAddress: string): Promise<ChannelHealth>;
}
