import type { Language } from '@prisma/client';

/**
 * Doctor-facing console labels, separate from the patient templates in
 * templates.ts because the audiences and the register differ — a doctor sees
 * terse operational labels, a patient sees full sentences.
 *
 * Kannada strings run noticeably longer than English (roughly 1.3-1.8x for
 * these labels), so every layout that consumes them wraps rather than
 * truncating, and no button width is fixed.
 */
export interface ConsoleStrings {
  nowServing: string;
  noOneInRoom: string;
  inRoomFor: (mins: string) => string;
  callNext: string;
  callNextWith: (token: number, name: string) => string;
  nobodyWaiting: string;
  waiting: string;
  issuedToday: string;
  avgWait: string;
  queue: string;
  bookings: string;
  patients: string;
  reports: string;
  signOut: string;
  settings: string;
  clinicDetails: string;
  bookingConfig: string;
  workingHours: string;
  dailyCap: string;
  consultLength: string;
  learnedAverage: string;
  timezoneLabel: string;
  languageLabel: string;
  closedDay: string;
  changesViaAdmin: string;
  account: string;
  sections: string;
  waitingList: string;
  bookedAt: (time: string) => string;
  waitedFor: (mins: string) => string;
  viaWhatsapp: string;
  recall: string;
  callIn: string;
  finishCurrent: string;
  oneAtATime: string;
  noShow: string;
  arrived: string;
  done: string;
  runningLate: string;
  runningLateSub: string;
  customMinutes: string;
  announceDelay: string;
  willSendTo: (n: number) => string;
  messagePreview: string;
  cancel: string;
  noBookingsTitle: string;
  noBookingsBody: string;
  scanToBook: string;
  shareLink: string;
  updatedAgo: (secs: string) => string;
  justNow: string;
  delayActive: (mins: number) => string;
  onLeave: string;
  listClosed: string;
}

const en: ConsoleStrings = {
  nowServing: 'Now serving',
  noOneInRoom: 'No one in the room',
  inRoomFor: (m) => `In the room ${m}`,
  callNext: 'Call next patient',
  callNextWith: (t, n) => `Token ${t} · ${n}`,
  nobodyWaiting: 'Nobody is waiting',
  waiting: 'Waiting',
  issuedToday: 'Issued today',
  avgWait: 'Avg wait',
  queue: 'Queue',
  bookings: 'Bookings',
  patients: 'Patients',
  reports: 'Reports',
  signOut: 'Sign out',
  settings: 'Settings',
  clinicDetails: 'Clinic',
  bookingConfig: 'Booking',
  workingHours: 'Working hours',
  dailyCap: 'Daily token cap',
  consultLength: 'Consult length',
  learnedAverage: 'Learned average',
  timezoneLabel: 'Timezone',
  languageLabel: 'Language',
  closedDay: 'Closed',
  changesViaAdmin: 'To change these, contact your clinic administrator.',
  account: 'Account',
  sections: 'Sections',
  waitingList: 'Waiting',
  bookedAt: (t) => `Booked ${t}`,
  waitedFor: (m) => `Waiting ${m}`,
  viaWhatsapp: 'WhatsApp',
  recall: 'Recall',
  callIn: 'Call in',
  finishCurrent: 'Finish current patient',
  oneAtATime: 'Finish with the current patient first',
  noShow: 'No show',
  arrived: 'Arrived',
  done: 'Done',
  runningLate: 'Running late?',
  runningLateSub: 'Tell everyone still waiting. This adds to every estimate today.',
  customMinutes: 'Custom',
  announceDelay: 'Send to waiting patients',
  willSendTo: (n) => `Sends to ${n} ${n === 1 ? 'patient' : 'patients'} on WhatsApp`,
  messagePreview: 'They will receive',
  cancel: 'Cancel',
  noBookingsTitle: 'No bookings yet today',
  noBookingsBody:
    'Patients book by messaging your clinic on WhatsApp. Show this code at reception, or share the link.',
  scanToBook: 'Scan to book',
  shareLink: 'Share booking link',
  updatedAgo: (s) => `updated ${s} ago`,
  justNow: 'updated just now',
  delayActive: (m) => `Running ${m} min late`,
  onLeave: 'You are marked on leave today',
  listClosed: 'Token list is closed — no new bookings today',
};

const kn: ConsoleStrings = {
  nowServing: 'ಈಗ ನಡೆಯುತ್ತಿರುವುದು',
  noOneInRoom: 'ಕೊಠಡಿಯಲ್ಲಿ ಯಾರೂ ಇಲ್ಲ',
  inRoomFor: (m) => `ಕೊಠಡಿಯಲ್ಲಿ ${m}`,
  callNext: 'ಮುಂದಿನ ರೋಗಿಯನ್ನು ಕರೆಯಿರಿ',
  callNextWith: (t, n) => `ಟೋಕನ್ ${t} · ${n}`,
  nobodyWaiting: 'ಯಾರೂ ಕಾಯುತ್ತಿಲ್ಲ',
  waiting: 'ಕಾಯುತ್ತಿದ್ದಾರೆ',
  issuedToday: 'ಇವತ್ತು ನೀಡಿದ್ದು',
  avgWait: 'ಸರಾಸರಿ ಕಾಯುವಿಕೆ',
  queue: 'ಸರದಿ',
  bookings: 'ಬುಕಿಂಗ್',
  patients: 'ರೋಗಿಗಳು',
  reports: 'ವರದಿಗಳು',
  signOut: 'ಸೈನ್ ಔಟ್',
  settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
  clinicDetails: 'ಕ್ಲಿನಿಕ್',
  bookingConfig: 'ಬುಕಿಂಗ್',
  workingHours: 'ಕೆಲಸದ ಸಮಯ',
  dailyCap: 'ದಿನದ ಟೋಕನ್ ಮಿತಿ',
  consultLength: 'ಸಮಾಲೋಚನೆ ಅವಧಿ',
  learnedAverage: 'ಕಲಿತ ಸರಾಸರಿ',
  timezoneLabel: 'ಸಮಯ ವಲಯ',
  languageLabel: 'ಭಾಷೆ',
  closedDay: 'ಮುಚ್ಚಲಾಗಿದೆ',
  changesViaAdmin: 'ಇವುಗಳನ್ನು ಬದಲಾಯಿಸಲು ನಿಮ್ಮ ಕ್ಲಿನಿಕ್ ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  account: 'ಖಾತೆ',
  sections: 'ವಿಭಾಗಗಳು',
  waitingList: 'ಕಾಯುತ್ತಿರುವವರು',
  bookedAt: (t) => `ಬುಕ್ ${t}`,
  waitedFor: (m) => `ಕಾಯುತ್ತಿದ್ದಾರೆ ${m}`,
  viaWhatsapp: 'ವಾಟ್ಸಾಪ್',
  recall: 'ಮತ್ತೆ ಕರೆಯಿರಿ',
  callIn: 'ಒಳಗೆ ಕರೆಯಿರಿ',
  finishCurrent: 'ಈಗಿನ ರೋಗಿಯನ್ನು ಮುಗಿಸಿ',
  oneAtATime: 'ಮೊದಲು ಈಗಿನ ರೋಗಿಯನ್ನು ಮುಗಿಸಿ',
  noShow: 'ಬಂದಿಲ್ಲ',
  arrived: 'ಬಂದಿದ್ದಾರೆ',
  done: 'ಮುಗಿಯಿತು',
  runningLate: 'ತಡವಾಗುತ್ತಿದೆಯೇ?',
  runningLateSub:
    'ಕಾಯುತ್ತಿರುವ ಎಲ್ಲರಿಗೂ ತಿಳಿಸಿ. ಇದು ಇವತ್ತಿನ ಎಲ್ಲಾ ಅಂದಾಜಿಗೆ ಸೇರುತ್ತದೆ.',
  customMinutes: 'ಬೇರೆ',
  announceDelay: 'ಕಾಯುತ್ತಿರುವವರಿಗೆ ಕಳುಹಿಸಿ',
  willSendTo: (n) => `${n} ರೋಗಿಗೆ ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಲಾಗುತ್ತದೆ`,
  messagePreview: 'ಅವರಿಗೆ ಸಿಗುವ ಸಂದೇಶ',
  cancel: 'ರದ್ದು',
  noBookingsTitle: 'ಇವತ್ತು ಇನ್ನೂ ಬುಕಿಂಗ್ ಇಲ್ಲ',
  noBookingsBody:
    'ರೋಗಿಗಳು ನಿಮ್ಮ ಕ್ಲಿನಿಕ್‌ಗೆ ವಾಟ್ಸಾಪ್ ಸಂದೇಶ ಕಳುಹಿಸಿ ಬುಕ್ ಮಾಡುತ್ತಾರೆ. ಈ ಕೋಡ್ ಅನ್ನು ಸ್ವಾಗತದಲ್ಲಿ ತೋರಿಸಿ, ಅಥವಾ ಲಿಂಕ್ ಹಂಚಿಕೊಳ್ಳಿ.',
  scanToBook: 'ಬುಕ್ ಮಾಡಲು ಸ್ಕ್ಯಾನ್ ಮಾಡಿ',
  shareLink: 'ಬುಕಿಂಗ್ ಲಿಂಕ್ ಹಂಚಿಕೊಳ್ಳಿ',
  updatedAgo: (s) => `${s} ಹಿಂದೆ ನವೀಕರಿಸಲಾಗಿದೆ`,
  justNow: 'ಈಗಷ್ಟೇ ನವೀಕರಿಸಲಾಗಿದೆ',
  delayActive: (m) => `${m} ನಿಮಿಷ ತಡವಾಗಿ ನಡೆಯುತ್ತಿದೆ`,
  onLeave: 'ಇವತ್ತು ನೀವು ರಜೆಯಲ್ಲಿದ್ದೀರಿ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ',
  listClosed: 'ಟೋಕನ್ ಪಟ್ಟಿ ಮುಚ್ಚಲಾಗಿದೆ — ಇವತ್ತು ಹೊಸ ಬುಕಿಂಗ್ ಇಲ್ಲ',
};

export const consoleStrings: Record<Language, ConsoleStrings> = { EN: en, KN: kn };

export function c(language: Language): ConsoleStrings {
  return consoleStrings[language] ?? en;
}

/** Compact elapsed label: "4 min", "1 hr 20 min". Kept short for dense rows. */
export function elapsed(from: Date, language: Language, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  const isKn = language === 'KN';
  if (mins < 1) return isKn ? 'ಈಗಷ್ಟೇ' : 'just now';
  if (mins < 60) return `${mins} ${isKn ? 'ನಿಮಿಷ' : 'min'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hrs = `${h} ${isKn ? 'ಗಂಟೆ' : 'hr'}`;
  return m === 0 ? hrs : `${hrs} ${m} ${isKn ? 'ನಿಮಿಷ' : 'min'}`;
}
