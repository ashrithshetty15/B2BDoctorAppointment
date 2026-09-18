/**
 * Input normalisation. Patients type "1", "book", "token beku", or tap a button
 * whose payload the adapter flattened to text — flows should not each re-derive
 * that. Keyword lists cover English, Kanglish, and Kannada script: the bot
 * replies in Kannada script, so patients answer in it even though the menus
 * also accept numbers.
 */

const RESTART_WORDS = [
  'hi',
  'hello',
  'hey',
  'start',
  'menu',
  'namaste',
  'namaskara',
  'namaskar',
  'hii',
  'hlo',
  'ನಮಸ್ಕಾರ',
  'ನಮಸ್ತೆ',
  'ಹಾಯ್',
  'ಮೆನು',
  'ಪ್ರಾರಂಭ',
  'ಶುರು',
];

const YES_WORDS = [
  'yes',
  'y',
  'ok',
  'okay',
  'confirm',
  'haudu',
  'howdu',
  'ha',
  'sari',
  'yes please',
  'ಹೌದು',
  'ಸರಿ',
  'ಆಯ್ತು',
  'ಆಯಿತು',
  'ಒಪ್ಪಿಗೆ',
];
const NO_WORDS = ['no', 'n', 'cancel', 'back', 'illa', 'beda', 'ಇಲ್ಲ', 'ಬೇಡ', 'ಹಿಂದೆ'];

const BOOK_WORDS = [
  'book',
  'booking',
  'token',
  'appointment',
  'new',
  'book maadi',
  'ಟೋಕನ್',
  'ಬುಕ್',
  'ಅಪಾಯಿಂಟ್ಮೆಂಟ್',
  'ಹೊಸ',
];
const STATUS_WORDS = [
  'status',
  'position',
  'where',
  'queue',
  'check',
  'my token',
  'nanna token',
  'ಸ್ಥಿತಿ',
  'ಸರದಿ',
  'ಎಲ್ಲಿ',
  'ನನ್ನ ಟೋಕನ್',
];
const CANCEL_WORDS = ['cancel', 'cancel maadi', 'remove', 'radd', 'ರದ್ದು', 'ರದ್ದುಮಾಡಿ', 'ತೆಗೆದುಹಾಕಿ'];

export function clean(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Bare numeric menu choice, or null. */
export function numericChoice(input: string): number | null {
  const c = clean(input);
  if (!/^\d{1,2}$/.test(c)) return null;
  const n = Number(c);
  return Number.isInteger(n) ? n : null;
}

/**
 * Asking for a different doctor, from anywhere in the conversation.
 *
 * Needed because the choice is otherwise made once and kept for the rest of the
 * session: a patient who picked the wrong doctor had no way back short of
 * waiting two hours for the session to expire.
 *
 * Matched on the whole message rather than a substring — "my appointment with
 * the doctor" is not a request to switch.
 */
const DOCTOR_SWITCH_WORDS = [
  'doctor',
  'doctors',
  'change doctor',
  'switch doctor',
  'other doctor',
  'another doctor',
  'different doctor',
  'change dr',
  'bere doctor',
  'ವೈದ್ಯ',
  'ವೈದ್ಯರು',
  'ಡಾಕ್ಟರ್',
  'ಬೇರೆ ವೈದ್ಯ',
  'ಬೇರೆ ಡಾಕ್ಟರ್',
  'ವೈದ್ಯರನ್ನು ಬದಲಿಸಿ',
];

export function isDoctorSwitchRequest(input: string): boolean {
  return DOCTOR_SWITCH_WORDS.includes(clean(input));
}

export function isRestart(input: string): boolean {
  const c = clean(input);
  return RESTART_WORDS.includes(c);
}

export function isYes(input: string): boolean {
  const c = clean(input);
  return c === '1' || YES_WORDS.includes(c);
}

export function isNo(input: string): boolean {
  const c = clean(input);
  return c === '2' || NO_WORDS.includes(c);
}

export type MenuIntent = 'BOOK' | 'STATUS' | 'CANCEL' | 'UNKNOWN';

/** Map a main-menu turn to an intent, accepting numbers or keywords. */
export function menuIntent(input: string): MenuIntent {
  const n = numericChoice(input);
  if (n === 1) return 'BOOK';
  if (n === 2) return 'STATUS';
  if (n === 3) return 'CANCEL';

  const c = clean(input);
  // Order matters: "cancel" also appears in CANCEL_WORDS and NO_WORDS.
  if (CANCEL_WORDS.some((w) => c === w || c.startsWith(`${w} `))) return 'CANCEL';
  if (STATUS_WORDS.some((w) => c.includes(w))) return 'STATUS';
  if (BOOK_WORDS.some((w) => c.includes(w))) return 'BOOK';
  return 'UNKNOWN';
}
