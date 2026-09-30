import { describe, expect, it } from 'vitest';
import { dialledNumberCandidates, normalisePhone } from './phone';

const digits = (input: string) => {
  const r = normalisePhone(input);
  return r.ok ? r.digits : null;
};

const reason = (input: unknown) => {
  const r = normalisePhone(input);
  return r.ok ? null : r.reason;
};

describe('normalisePhone', () => {
  it('strips the punctuation people actually paste', () => {
    expect(digits('+91 98765 43210')).toBe('919876543210');
    expect(digits('+91-98765-43210')).toBe('919876543210');
    expect(digits('(91) 98765 43210')).toBe('919876543210');
    expect(digits('91.98765.43210')).toBe('919876543210');
  });

  it('leaves an already-clean number alone', () => {
    expect(digits('919876543210')).toBe('919876543210');
    expect(digits('15553012465')).toBe('15553012465');
  });

  /**
   * The stored value is rendered as `+${whatsappNumber}`, so a surviving plus
   * would show as "++91...". This is the bug the normaliser exists to prevent.
   */
  it('drops a leading plus so the UI does not double it', () => {
    expect(digits('+919876543210')).toBe('919876543210');
    expect(digits('+919876543210')?.startsWith('+')).toBe(false);
  });

  /**
   * Rejected rather than stripped: quietly turning "9876 ext 5" into "98765"
   * yields a number that looks valid and reaches nobody.
   */
  it('rejects anything containing letters rather than stripping them', () => {
    expect(reason('9876 ext 5')).toBe('NOT_A_NUMBER');
    expect(reason('919876543210x')).toBe('NOT_A_NUMBER');
    expect(reason('call me')).toBe('NOT_A_NUMBER');
  });

  it('rejects numbers too short to include a country code', () => {
    expect(reason('12345')).toBe('TOO_SHORT');
    expect(reason('+91 98765')).toBe('TOO_SHORT');
  });

  it('rejects numbers beyond the E.164 ceiling', () => {
    expect(reason('1234567890123456')).toBe('TOO_LONG');
  });

  it('accepts the E.164 boundary lengths', () => {
    expect(digits('12345678')).toBe('12345678');
    expect(digits('123456789012345')).toBe('123456789012345');
  });

  it('treats empty and non-strings as missing, not malformed', () => {
    expect(reason('')).toBe('EMPTY');
    expect(reason('   ')).toBe('EMPTY');
    expect(reason(undefined)).toBe('EMPTY');
    expect(reason(null)).toBe('EMPTY');
    expect(reason(919876543210)).toBe('EMPTY');
  });

  /** What the QR builder produces must survive a round trip unchanged. */
  it('is idempotent', () => {
    const once = digits('+91 98765 43210')!;
    expect(digits(once)).toBe(once);
  });
});

/**
 * Matching the number Exotel says was dialled.
 *
 * Exotel reports CallTo as the carrier hands it, so one ExoPhone arrives as
 * "08047288908" or "+918047288908" on different calls. The webhook matches it
 * against a stored missedCallNumber by equality, so a mismatch in form reads as
 * "no clinic for this number" — authenticated, routed, and silent.
 */
describe('dialledNumberCandidates', () => {
  const EXOPHONE_FORMS = ['08047288908', '8047288908', '+91 80 4728 8908', '918047288908'];

  it.each(EXOPHONE_FORMS)('matches a clinic stored as 918047288908 when Exotel says %s', (form) => {
    expect(dialledNumberCandidates(form)).toContain('918047288908');
  });

  it.each(EXOPHONE_FORMS)('matches a clinic stored as 08047288908 when Exotel says %s', (form) => {
    expect(dialledNumberCandidates(form)).toContain('08047288908');
  });

  /** Every spelling of one number must agree, or the two lookups disagree. */
  it('gives every form of the same number an identical candidate set', () => {
    const sets = EXOPHONE_FORMS.map((f) => [...dialledNumberCandidates(f)].sort().join(','));
    expect(new Set(sets).size).toBe(1);
  });

  /**
   * The guard that earns its keep: this mobile starts with "91" and is exactly
   * ten digits. Stripping a country code blindly would leave "80354172" and
   * match nothing — or worse, something else.
   */
  it('does not mistake the leading 91 of a ten-digit mobile for a country code', () => {
    const c = dialledNumberCandidates('9180354172');
    expect(c).toContain('9180354172');
    expect(c).toContain('919180354172');
    expect(c).not.toContain('80354172');
  });

  it('shares no candidate with a genuinely different number', () => {
    const a = dialledNumberCandidates('918047288908');
    const b = dialledNumberCandidates('919731028452');
    expect(a.filter((x) => b.includes(x))).toEqual([]);
  });

  it('has nothing to try for an empty or junk value', () => {
    expect(dialledNumberCandidates('')).toEqual([]);
    expect(dialledNumberCandidates('abc')).toEqual([]);
  });

  /** All zeroes reduce to no core; it must not produce "0" or "91" as a match. */
  it('does not invent candidates from a number that is only zeroes', () => {
    expect(dialledNumberCandidates('000')).toEqual(['000']);
  });
});
