import { describe, expect, it } from 'vitest';
import { c, consoleStrings, elapsed } from './console';

describe('console strings', () => {
  it('implements every key in both languages', () => {
    const en = Object.keys(consoleStrings.EN).sort();
    const kn = Object.keys(consoleStrings.KN).sort();
    expect(kn).toEqual(en);
  });

  it('renders every string non-empty and without a stray undefined', () => {
    for (const [lang, set] of Object.entries(consoleStrings)) {
      for (const [key, value] of Object.entries(set)) {
        const rendered = typeof value === 'function' ? value(3, 'Asha') : value;
        expect(String(rendered).length, `${lang}.${key}`).toBeGreaterThan(0);
        expect(String(rendered), `${lang}.${key}`).not.toContain('undefined');
      }
    }
  });

  it('falls back to English for an unknown language', () => {
    expect(c('EN' as never).callNext).toBe(consoleStrings.EN.callNext);
    expect(c(undefined as never).callNext).toBe(consoleStrings.EN.callNext);
  });

  it('keeps Kannada labels genuinely translated, not copied from English', () => {
    // A copied English label would silently ship untranslated UI.
    expect(consoleStrings.KN.callNext).not.toBe(consoleStrings.EN.callNext);
    expect(consoleStrings.KN.nowServing).not.toBe(consoleStrings.EN.nowServing);
    expect(consoleStrings.KN.noShow).not.toBe(consoleStrings.EN.noShow);
  });
});

describe('elapsed', () => {
  const base = new Date('2026-09-13T10:00:00Z');
  const at = (mins: number) => new Date(base.getTime() + mins * 60_000);

  it('reads as minutes under an hour', () => {
    expect(elapsed(base, 'EN', at(12))).toBe('12 min');
    expect(elapsed(base, 'KN', at(12))).toBe('12 ನಿಮಿಷ');
  });

  it('switches to hours and drops a zero remainder', () => {
    expect(elapsed(base, 'EN', at(60))).toBe('1 hr');
    expect(elapsed(base, 'EN', at(95))).toBe('1 hr 35 min');
  });

  it('says just now under a minute rather than "0 min"', () => {
    expect(elapsed(base, 'EN', at(0))).toBe('just now');
    expect(elapsed(base, 'KN', at(0))).toBe('ಈಗಷ್ಟೇ');
  });

  it('never renders a negative duration from clock skew', () => {
    expect(elapsed(at(5), 'EN', base)).toBe('just now');
  });
});
