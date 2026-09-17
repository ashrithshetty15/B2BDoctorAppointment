/**
 * Normalising a dialable WhatsApp number.
 *
 * `Doctor.whatsappNumber` is stored digits-only ("15553012465") because it is
 * rendered as `+${doctor.whatsappNumber}` in the console and fed to `bookingLink`
 * to build the wa.me URL. A value pasted as "+91 98765 43210" would otherwise
 * display as "++91 98765 43210".
 *
 * Normalising once on write rather than at each of the four read sites means a
 * stored value is always already correct — the read sites cannot drift.
 */

/**
 * Shortest and longest plausible E.164 subscriber numbers including the country
 * code. E.164 caps at 15; the floor is deliberately loose because country plans
 * vary and rejecting a valid number is worse than storing an odd one.
 */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

export type PhoneResult =
  | { ok: true; digits: string }
  | { ok: false; reason: 'EMPTY' | 'NOT_A_NUMBER' | 'TOO_SHORT' | 'TOO_LONG' };

/**
 * "+91 98765 43210" -> "919876543210".
 *
 * Strips the punctuation people paste — spaces, dashes, brackets, a leading plus.
 * Anything else (letters, an extension marker) is rejected rather than silently
 * stripped: quietly turning "9876 ext 5" into "98765" would produce a number that
 * looks valid and reaches nobody.
 */
export function normalisePhone(input: unknown): PhoneResult {
  if (typeof input !== 'string') return { ok: false, reason: 'EMPTY' };

  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'EMPTY' };

  // Allowed separators only; everything else disqualifies the whole value.
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return { ok: false, reason: 'NOT_A_NUMBER' };

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < MIN_DIGITS) return { ok: false, reason: 'TOO_SHORT' };
  if (digits.length > MAX_DIGITS) return { ok: false, reason: 'TOO_LONG' };

  return { ok: true, digits };
}

/** Operator-facing explanation, so a rejected paste says what to do about it. */
export function phoneError(reason: Exclude<PhoneResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'NOT_A_NUMBER':
      return 'WhatsApp number must contain digits only, e.g. 919876543210';
    case 'TOO_SHORT':
      return `WhatsApp number looks too short — include the country code, e.g. 919876543210`;
    case 'TOO_LONG':
      return `WhatsApp number looks too long — it should be at most ${MAX_DIGITS} digits`;
    case 'EMPTY':
    default:
      return 'WhatsApp number is required';
  }
}
