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

/**
 * The same dialled number, written every way it might arrive.
 *
 * Exotel reports `CallTo` in whatever form the carrier hands it, and an ExoPhone
 * like Bangalore's 08047288908 can turn up as "08047288908", "8047288908" or
 * "+918047288908". The missed-call webhook matches that value against a stored
 * `missedCallNumber` by equality, so a number typed into the console in one form
 * and reported in another simply never matches: the call is authenticated,
 * falls through to "no clinic for this number", and the patient gets silence.
 * Nothing about that failure looks like a formatting problem from the outside.
 *
 * `normalisePhone` above does not help here — it strips punctuation, but still
 * treats 08047288908 and 918047288908 as two different numbers.
 *
 * A small candidate set rather than a suffix comparison, deliberately: this runs
 * on every incoming call, and `LIKE '%…'` cannot use the unique index on
 * `missed_call_number`, whereas an `IN` of four exact strings can.
 */
export function dialledNumberCandidates(input: string): string[] {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) return [];

  // Reduce to the subscriber number: drop the country code, then any trunk zero.
  //
  // The length guard is load-bearing. Jalaja's own mobile, 9180354172, begins
  // with "91" and is exactly ten digits — stripping it blindly would leave
  // "80354172" and match the wrong clinic, or none at all.
  let core = digits;
  if (core.startsWith('91') && core.length > 10) core = core.slice(2);
  core = core.replace(/^0+/, '');

  if (!core) return [digits];

  return [...new Set([digits, core, `0${core}`, `91${core}`])];
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
