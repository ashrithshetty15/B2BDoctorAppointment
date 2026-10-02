import crypto from 'node:crypto';

/**
 * The clinic code, for clinics served by the shared platform number.
 *
 * Two ways into this product now coexist:
 *
 *   - **Own number.** The clinic brings its own WhatsApp Business number, and
 *     Meta's `phone_number_id` identifies it. Their name is the sender. This is
 *     how Dentin and Jalaja work and nothing about them changes.
 *
 *   - **Shared number.** The clinic has no WABA of its own, so one platform
 *     number serves many clinics and a code in the deeplink says which. No Meta
 *     business verification, no Embedded Signup — a clinic can be live the same
 *     afternoon. The trade is that the sender is the platform, not the clinic.
 *
 * The second exists because Meta business verification is the single biggest
 * obstacle to onboarding a small practice. It is the entry tier; a clinic that
 * wants its own name on the chat upgrades to its own number later, and the
 * routing above handles both without either knowing about the other.
 */

/**
 * No O/0 and no I/1.
 *
 * These get read down a phone line and retyped by a patient who deleted the
 * prefilled text. A character that looks like another sends someone to the
 * wrong clinic — which, with health data, is worse than sending them nowhere.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;

/** `C-` then CODE_LEN characters, e.g. `C-K7QXM`. */
export const CODE_PATTERN = new RegExp(`\\bC-([${ALPHABET}]{${CODE_LEN}})\\b`, 'i');

/**
 * A new code. Rejection sampling rather than modulo, so no character is more
 * likely than another. Uniqueness is the caller's to enforce.
 */
export function newClinicCode(): string {
  let out = '';
  while (out.length < CODE_LEN) {
    for (const byte of crypto.randomBytes(CODE_LEN)) {
      if (byte < 256 - (256 % ALPHABET.length)) {
        out += ALPHABET[byte % ALPHABET.length];
        if (out.length === CODE_LEN) break;
      }
    }
  }
  return `C-${out}`;
}

/**
 * The code inside whatever the patient actually sent.
 *
 * Permissive about what surrounds it, strict about its shape. The prefilled
 * text is editable, so "Book an appointment C-K7QXM", "c-k7qxm" and "hi I need
 * to see the doctor C-K7QXM" must all work — while "book", "1" and "cancel"
 * must not, because this runs against every inbound message and an eager match
 * would hijack an ordinary conversation.
 */
export function parseClinicCode(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const m = CODE_PATTERN.exec(text);
  return m?.[1] ? `C-${m[1].toUpperCase()}` : null;
}

/** The deeplink a clinic prints on a card, a board, or a QR code. */
export function clinicDeeplink(platformNumber: string, code: string): string {
  const digits = platformNumber.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Book an appointment ${code}`)}`;
}
