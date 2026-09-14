import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_PRESETS, addDays, isDue, presetDays, presetLabel } from './followUp';

describe('presetDays', () => {
  it('maps every offered chip to an offset', () => {
    for (const p of FOLLOW_UP_PRESETS) {
      expect(presetDays(p.key)).toBe(p.days);
    }
  });

  /** The value arrives from a form, so anything at all can be posted. */
  it('rejects anything that is not a known preset', () => {
    expect(presetDays('7')).toBeNull();
    expect(presetDays('')).toBeNull();
    expect(presetDays('__proto__')).toBeNull();
    expect(presetDays('99y')).toBeNull();
  });
});

describe('addDays', () => {
  /**
   * @db.Date values round-trip as UTC midnight. Doing this arithmetic in local
   * time is how a follow-up ends up a day early or late.
   */
  it('stays at UTC midnight', () => {
    const from = new Date(Date.UTC(2026, 8, 14));
    const out = addDays(from, 14);
    expect(out.toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });

  it('crosses a month boundary', () => {
    expect(addDays(new Date(Date.UTC(2026, 8, 25)), 14).toISOString().slice(0, 10)).toBe(
      '2026-10-09',
    );
  });

  it('crosses a year boundary', () => {
    expect(addDays(new Date(Date.UTC(2026, 11, 25)), 30).toISOString().slice(0, 10)).toBe(
      '2027-01-24',
    );
  });

  it('handles a leap day', () => {
    expect(addDays(new Date(Date.UTC(2028, 1, 28)), 1).toISOString().slice(0, 10)).toBe(
      '2028-02-29',
    );
  });
});

describe('isDue', () => {
  const today = new Date(Date.UTC(2026, 8, 14));

  it('is true on the day itself', () => {
    expect(isDue(new Date(Date.UTC(2026, 8, 14)), today)).toBe(true);
  });

  it('is true when overdue, so nothing quietly falls off the list', () => {
    expect(isDue(new Date(Date.UTC(2026, 7, 1)), today)).toBe(true);
  });

  it('is false while still in the future', () => {
    expect(isDue(new Date(Date.UTC(2026, 8, 15)), today)).toBe(false);
  });
});

describe('presetLabel', () => {
  it('has a label for every preset in both languages', () => {
    for (const p of FOLLOW_UP_PRESETS) {
      expect(presetLabel(p.key, 'EN')).toBeTruthy();
      expect(presetLabel(p.key, 'KN')).toBeTruthy();
      // Kannada must actually be Kannada, not an English fallback.
      expect(presetLabel(p.key, 'KN')).toMatch(/[ಀ-೿]/);
    }
  });
});
