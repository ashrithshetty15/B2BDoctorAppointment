import { describe, expect, it } from 'vitest';
import { isNo, isRestart, isYes, menuIntent, numericChoice } from './intent';

describe('numericChoice', () => {
  it('reads bare numbers and ignores anything else', () => {
    expect(numericChoice('1')).toBe(1);
    expect(numericChoice(' 3 ')).toBe(3);
    expect(numericChoice('book')).toBeNull();
    expect(numericChoice('1st')).toBeNull();
  });
});

describe('menuIntent', () => {
  it('maps menu numbers', () => {
    expect(menuIntent('1')).toBe('BOOK');
    expect(menuIntent('2')).toBe('STATUS');
    expect(menuIntent('3')).toBe('CANCEL');
  });

  it('maps English and Kanglish keywords', () => {
    expect(menuIntent('book')).toBe('BOOK');
    expect(menuIntent('token beku')).toBe('BOOK');
    expect(menuIntent('my token')).toBe('STATUS');
    expect(menuIntent('nanna token')).toBe('STATUS');
    expect(menuIntent('cancel')).toBe('CANCEL');
  });

  it('does not guess at unrelated text', () => {
    expect(menuIntent('kya haal hai')).toBe('UNKNOWN');
  });

  it('prefers cancel over book when the word "cancel" leads', () => {
    expect(menuIntent('cancel my appointment')).toBe('CANCEL');
  });
});

describe('yes / no / restart', () => {
  it('treats 1 as yes and 2 as no in confirmations', () => {
    expect(isYes('1')).toBe(true);
    expect(isNo('2')).toBe(true);
  });

  it('accepts Kanglish confirmations', () => {
    expect(isYes('haudu')).toBe(true);
    expect(isNo('beda')).toBe(true);
  });

  it('recognises greetings as a restart', () => {
    expect(isRestart('hi')).toBe(true);
    expect(isRestart('namaskara')).toBe(true);
    expect(isRestart('book')).toBe(false);
  });
});
