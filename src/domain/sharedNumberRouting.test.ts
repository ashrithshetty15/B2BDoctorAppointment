import { describe, expect, it } from 'vitest';
import { clinicDeeplink, newClinicCode, parseClinicCode } from './clinicCode';
import { resolveSharedNumberClinic, type SharedNumberInput } from './sharedNumberRouting';

/**
 * Routing on the shared platform number.
 *
 * On a clinic's own number this never runs — the phone_number_id is the tenant,
 * as it always was. This is the other route, where many clinics share one number
 * and a deeplink code is the only thing that can say which one a patient means.
 *
 * The standard is the one the existing resolver already sets: refuse rather than
 * guess. Handing a patient to the wrong practice means handing over their name,
 * their number and their history, and in a clinic it means a medical appointment
 * at a practice that has never seen them.
 */

const base: SharedNumberInput = {
  codeInText: null,
  clinicForCode: null,
  sessionClinicId: null,
  priorClinicIds: [],
};
const given = (over: Partial<SharedNumberInput>) => resolveSharedNumberClinic({ ...base, ...over });

describe('finding the code in what the patient actually sent', () => {
  it('reads it from the unedited prefilled message', () => {
    expect(parseClinicCode('Book an appointment C-K7QXM')).toBe('C-K7QXM');
  });

  it.each([
    ['c-k7qxm', 'lowercase'],
    ['hi I need to see the doctor C-K7QXM', 'wrapped in their own words'],
    ['C-K7QXM', 'code alone'],
    ['  Book an appointment   C-K7QXM  ', 'stray whitespace'],
  ])('still finds it in %s (%s)', (text) => {
    expect(parseClinicCode(text)).toBe('C-K7QXM');
  });

  /** Runs on every inbound, so an eager match would hijack a real conversation. */
  it.each([
    ['book', 'the bare intent word'],
    ['Book an appointment', 'prefill with the code deleted'],
    ['1', 'a menu choice'],
    ['cancel', 'a command'],
    ['C-K0QXM', 'contains a zero, excluded from the alphabet'],
    ['C-K1QXM', 'contains a one'],
    ['CK7QXM', 'missing the separator'],
    ['S-K7QXM', 'a SALON code, not a clinic one'],
    ['ಬುಕ್ ಮಾಡಿ', 'Kannada text'],
  ])('does not see a code in %s (%s)', (text) => {
    expect(parseClinicCode(text)).toBeNull();
  });

  it('generates codes it can read back, from the unambiguous alphabet only', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = newClinicCode();
      expect(parseClinicCode(`Book an appointment ${code}`)).toBe(code);
      expect(code).not.toMatch(/[O0I1]/);
    }
  });

  it('builds a deeplink that survives a round trip', () => {
    const url = clinicDeeplink('+91 97310 28452', 'C-K7QXM');

    expect(url).toBe('https://wa.me/919731028452?text=Book%20an%20appointment%20C-K7QXM');
    expect(parseClinicCode(decodeURIComponent(new URL(url).searchParams.get('text')!))).toBe('C-K7QXM');
  });
});

describe('deciding which clinic the patient means', () => {
  it('uses the code when the link is fresh', () => {
    expect(given({ codeInText: 'C-AAAAA', clinicForCode: 'dentin' })).toEqual({
      kind: 'CODE',
      clinicId: 'dentin',
      rebound: false,
    });
  });

  /**
   * Scanning a different clinic's QR mid-booking means that clinic. Letting the
   * live session win would strand the patient in the wrong practice with no exit
   * they could find.
   */
  it('lets a fresh code override a conversation in progress, and says it rebound', () => {
    expect(given({ codeInText: 'C-BBBBB', clinicForCode: 'jalaja', sessionClinicId: 'dentin' })).toEqual({
      kind: 'CODE',
      clinicId: 'jalaja',
      rebound: true,
    });
  });

  it('does not call it a rebind when the code matches the clinic they are already in', () => {
    expect(
      given({ codeInText: 'C-AAAAA', clinicForCode: 'dentin', sessionClinicId: 'dentin' }),
    ).toMatchObject({ rebound: false });
  });

  it('carries the clinic through the rest of the conversation, with no code', () => {
    expect(given({ sessionClinicId: 'dentin' })).toEqual({ kind: 'SESSION', clinicId: 'dentin' });
  });

  it('remembers the only clinic a returning patient has used', () => {
    expect(given({ priorClinicIds: ['dentin'] })).toEqual({ kind: 'ONLY_PRIOR', clinicId: 'dentin' });
  });

  it('asks when the patient uses more than one clinic', () => {
    expect(given({ priorClinicIds: ['jalaja', 'dentin'] })).toEqual({
      kind: 'ASK',
      choices: ['jalaja', 'dentin'],
    });
  });

  it('tells a stranger with no code that it cannot help yet', () => {
    expect(given({})).toEqual({ kind: 'UNKNOWN' });
  });

  /** A typo or a stale card must not dead-end a regular patient. */
  it('falls back gracefully when the code matches no clinic', () => {
    expect(given({ codeInText: 'C-ZZZZZ', sessionClinicId: 'dentin' })).toMatchObject({
      kind: 'SESSION',
    });
    expect(given({ codeInText: 'C-ZZZZZ', priorClinicIds: ['jalaja'] })).toMatchObject({
      kind: 'ONLY_PRIOR',
    });
    expect(given({ codeInText: 'C-ZZZZZ' })).toEqual({ kind: 'UNKNOWN' });
  });

  it('prefers code over session, session over history', () => {
    const all = {
      codeInText: 'C-CCCCC',
      clinicForCode: 'new',
      sessionClinicId: 'session',
      priorClinicIds: ['old1', 'old2'],
    };

    expect(given(all)).toMatchObject({ kind: 'CODE', clinicId: 'new' });
    expect(given({ ...all, codeInText: null, clinicForCode: null })).toMatchObject({
      kind: 'SESSION',
    });
    expect(
      given({ ...all, codeInText: null, clinicForCode: null, sessionClinicId: null }),
    ).toMatchObject({ kind: 'ASK' });
  });

  /**
   * The standard the existing resolver sets, restated here: never resolve to a
   * clinic nobody named.
   */
  it('never invents a clinic', () => {
    for (const out of [given({}), given({ priorClinicIds: ['a', 'b'] })]) {
      expect(['ASK', 'UNKNOWN']).toContain(out.kind);
      expect(out).not.toHaveProperty('clinicId');
    }
  });
});
