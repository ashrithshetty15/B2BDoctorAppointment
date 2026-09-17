import { describe, expect, it } from 'vitest';
import { normalisePhone } from './phone';

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
