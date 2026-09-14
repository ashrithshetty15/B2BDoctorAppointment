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
  notesLabel: string;
  notesHint: string;
  notesPlaceholder: string;
  addNote: string;
  editNote: string;
  saveNote: string;
  noteSaved: string;
  noReportBody: string;
  backToPatients: string;
  seenCount: string;
  useQueueToday: string;
  returning: string;
  visitOne: string;
  visitMany: string;
  noPatientsTitle: string;
  noPatientsBody: string;
  noBookingsThisDay: string;
  noReportData: string;
  calendar: string;
  bookedCount: string;
  freeCount: string;
  slotFree: string;
  slotPast: string;
  bookThisSlot: string;
  confirmBooking: string;
  backToToday: string;
  noSlotsTitle: string;
  noSlotsBody: string;
  slotTaken: string;
  slotNotValid: string;
  slotInPast: string;
  patientHasSlot: string;
  slotBooked: (time: string, name: string) => string;
  addWalkIn: string;
  addWalkInSub: string;
  patientNameLabel: string;
  patientPhoneLabel: string;
  phoneHint: string;
  languageForPatient: string;
  issueToken: string;
  tokenIssued: (token: number, name: string) => string;
  alreadyHasToken: (token: number) => string;
  capReached: string;
  listClosedShort: string;
  onLeaveShort: string;
  invalidPhone: string;
  invalidName: string;
  profile: string;
  profileSub: string;
  doctorNameLabel: string;
  clinicNameLabel: string;
  specialtyLabel: string;
  qualificationLabel: string;
  photoLabel: string;
  photoHint: string;
  removePhoto: string;
  saveProfile: string;
  profileSaved: string;
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
  notesLabel: 'Remarks',
  notesHint: 'Seen by you and your staff only — never sent to the patient.',
  notesPlaceholder: 'e.g. follow-up for BP, needs a chair',
  addNote: 'Add remark',
  editNote: 'Edit remark',
  saveNote: 'Save remark',
  noteSaved: 'Remark saved',
  noReportBody: 'Once patients start booking, this is where you will see how the clinic is running.',
  backToPatients: 'Back to patients',
  seenCount: 'Seen',
  useQueueToday: 'This is today — use Queue to work it.',
  returning: 'Returning',
  visitOne: 'visit',
  visitMany: 'visits',
  noPatientsTitle: 'No patients yet',
  noPatientsBody: 'Everyone who books with you appears here. Share this code or link so patients can book on WhatsApp.',
  noBookingsThisDay: 'Nothing booked this day',
  noReportData: 'No activity in this period yet',
  calendar: 'Calendar',
  bookedCount: 'Booked',
  freeCount: 'Free',
  slotFree: 'Free',
  slotPast: 'Passed',
  bookThisSlot: 'Book',
  confirmBooking: 'Confirm booking',
  backToToday: 'Back to today',
  noSlotsTitle: 'No appointment times this day',
  noSlotsBody: 'Working hours for this day are empty, or the clinic is closed. Set hours in the operator console.',
  slotTaken: 'That time was just taken. Pick another.',
  slotNotValid: 'That is not an appointment time for this day.',
  slotInPast: 'That time has already passed.',
  patientHasSlot: 'That patient already has an appointment that day',
  slotBooked: (time, name) => `${time} booked for ${name}`,
  addWalkIn: 'Add walk-in',
  addWalkInSub: 'For a patient at the desk or on the phone. They get the same WhatsApp updates.',
  patientNameLabel: 'Patient name',
  patientPhoneLabel: 'WhatsApp number',
  phoneHint: 'With country code, e.g. 919876543210',
  languageForPatient: 'Language for their messages',
  issueToken: 'Issue token',
  tokenIssued: (t, n) => `Token ${t} issued to ${n}`,
  alreadyHasToken: (t) => `That patient already holds token ${t} today`,
  capReached: 'Today is full — the daily token limit has been reached',
  listClosedShort: 'Token list is closed for today',
  onLeaveShort: 'You are marked on leave today',
  invalidPhone: 'Enter a valid number with country code, digits only',
  invalidName: 'Enter the patient name',
  profile: 'Profile',
  profileSub: 'This is how your clinic appears to you and to your team.',
  doctorNameLabel: 'Your name',
  clinicNameLabel: 'Clinic name',
  specialtyLabel: 'Specialty',
  qualificationLabel: 'Qualifications',
  photoLabel: 'Photo',
  photoHint: 'Square works best. Resized automatically before saving.',
  removePhoto: 'Remove photo',
  saveProfile: 'Save profile',
  profileSaved: 'Profile updated',
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
  notesLabel: 'ಟಿಪ್ಪಣಿ',
  notesHint: 'ನಿಮಗೆ ಮತ್ತು ನಿಮ್ಮ ಸಿಬ್ಬಂದಿಗೆ ಮಾತ್ರ ಕಾಣಿಸುತ್ತದೆ — ರೋಗಿಗೆ ಕಳುಹಿಸುವುದಿಲ್ಲ.',
  notesPlaceholder: 'ಉದಾ. ಬಿಪಿ ಫಾಲೋ-ಅಪ್, ಕುರ್ಚಿ ಬೇಕು',
  addNote: 'ಟಿಪ್ಪಣಿ ಸೇರಿಸಿ',
  editNote: 'ಟಿಪ್ಪಣಿ ಬದಲಾಯಿಸಿ',
  saveNote: 'ಟಿಪ್ಪಣಿ ಉಳಿಸಿ',
  noteSaved: 'ಟಿಪ್ಪಣಿ ಉಳಿಸಲಾಗಿದೆ',
  noReportBody: 'ರೋಗಿಗಳು ಬುಕ್ ಮಾಡಲು ಶುರುವಾದ ಮೇಲೆ, ಕ್ಲಿನಿಕ್ ಹೇಗೆ ನಡೆಯುತ್ತಿದೆ ಎಂಬುದು ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.',
  backToPatients: 'ರೋಗಿಗಳಿಗೆ ಹಿಂತಿರುಗಿ',
  seenCount: 'ನೋಡಿದ್ದು',
  useQueueToday: 'ಇದು ಇವತ್ತು — ಸರದಿ ಪುಟ ಬಳಸಿ.',
  returning: 'ಮತ್ತೆ ಬಂದವರು',
  visitOne: 'ಭೇಟಿ',
  visitMany: 'ಭೇಟಿಗಳು',
  noPatientsTitle: 'ಇನ್ನೂ ರೋಗಿಗಳಿಲ್ಲ',
  noPatientsBody: 'ನಿಮ್ಮ ಬಳಿ ಬುಕ್ ಮಾಡುವ ಎಲ್ಲರೂ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತಾರೆ. ರೋಗಿಗಳು ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಬುಕ್ ಮಾಡಲು ಈ ಕೋಡ್ ಅಥವಾ ಲಿಂಕ್ ಹಂಚಿಕೊಳ್ಳಿ.',
  noBookingsThisDay: 'ಈ ದಿನ ಏನೂ ಬುಕ್ ಆಗಿಲ್ಲ',
  noReportData: 'ಈ ಅವಧಿಯಲ್ಲಿ ಇನ್ನೂ ಚಟುವಟಿಕೆ ಇಲ್ಲ',
  calendar: 'ಕ್ಯಾಲೆಂಡರ್',
  bookedCount: 'ಬುಕ್ ಆಗಿದೆ',
  freeCount: 'ಖಾಲಿ',
  slotFree: 'ಖಾಲಿ',
  slotPast: 'ಕಳೆದಿದೆ',
  bookThisSlot: 'ಬುಕ್ ಮಾಡಿ',
  confirmBooking: 'ಬುಕಿಂಗ್ ಖಚಿತಪಡಿಸಿ',
  backToToday: 'ಇವತ್ತಿಗೆ ಹಿಂತಿರುಗಿ',
  noSlotsTitle: 'ಈ ದಿನ ಯಾವ ಸಮಯವೂ ಇಲ್ಲ',
  noSlotsBody: 'ಈ ದಿನಕ್ಕೆ ಕೆಲಸದ ಸಮಯ ಇಲ್ಲ, ಅಥವಾ ಕ್ಲಿನಿಕ್ ಮುಚ್ಚಿದೆ.',
  slotTaken: 'ಆ ಸಮಯ ಈಗ ತಾನೇ ಬುಕ್ ಆಯಿತು. ಬೇರೆ ಆಯ್ಕೆ ಮಾಡಿ.',
  slotNotValid: 'ಅದು ಈ ದಿನದ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಸಮಯ ಅಲ್ಲ.',
  slotInPast: 'ಆ ಸಮಯ ಈಗಾಗಲೇ ಕಳೆದಿದೆ.',
  patientHasSlot: 'ಆ ರೋಗಿಗೆ ಆ ದಿನ ಈಗಾಗಲೇ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಇದೆ',
  slotBooked: (time, name) => `${name} ಅವರಿಗೆ ${time} ಬುಕ್ ಮಾಡಲಾಗಿದೆ`,
  addWalkIn: 'ವಾಕ್-ಇನ್ ಸೇರಿಸಿ',
  addWalkInSub: 'ಕೌಂಟರ್‌ನಲ್ಲಿ ಅಥವಾ ಫೋನ್‌ನಲ್ಲಿರುವ ರೋಗಿಗೆ. ಅವರಿಗೂ ಅದೇ ವಾಟ್ಸಾಪ್ ಮಾಹಿತಿ ಸಿಗುತ್ತದೆ.',
  patientNameLabel: 'ರೋಗಿಯ ಹೆಸರು',
  patientPhoneLabel: 'ವಾಟ್ಸಾಪ್ ಸಂಖ್ಯೆ',
  phoneHint: 'ದೇಶದ ಕೋಡ್ ಸಹಿತ, ಉದಾ. 919876543210',
  languageForPatient: 'ಅವರ ಸಂದೇಶಗಳ ಭಾಷೆ',
  issueToken: 'ಟೋಕನ್ ನೀಡಿ',
  tokenIssued: (t, n) => `${n} ಅವರಿಗೆ ಟೋಕನ್ ${t} ನೀಡಲಾಗಿದೆ`,
  alreadyHasToken: (t) => `ಆ ರೋಗಿಗೆ ಇವತ್ತು ಈಗಾಗಲೇ ಟೋಕನ್ ${t} ಇದೆ`,
  capReached: 'ಇವತ್ತು ಭರ್ತಿಯಾಗಿದೆ — ದಿನದ ಟೋಕನ್ ಮಿತಿ ಮುಗಿದಿದೆ',
  listClosedShort: 'ಇವತ್ತಿಗೆ ಟೋಕನ್ ಪಟ್ಟಿ ಮುಚ್ಚಲಾಗಿದೆ',
  onLeaveShort: 'ಇವತ್ತು ನೀವು ರಜೆಯಲ್ಲಿದ್ದೀರಿ',
  invalidPhone: 'ದೇಶದ ಕೋಡ್ ಸಹಿತ ಸರಿಯಾದ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ, ಅಂಕಿಗಳು ಮಾತ್ರ',
  invalidName: 'ರೋಗಿಯ ಹೆಸರು ನಮೂದಿಸಿ',
  profile: 'ಪ್ರೊಫೈಲ್',
  profileSub: 'ನಿಮ್ಮ ಕ್ಲಿನಿಕ್ ಹೀಗೆ ಕಾಣಿಸುತ್ತದೆ.',
  doctorNameLabel: 'ನಿಮ್ಮ ಹೆಸರು',
  clinicNameLabel: 'ಕ್ಲಿನಿಕ್ ಹೆಸರು',
  specialtyLabel: 'ಪರಿಣತಿ',
  qualificationLabel: 'ವಿದ್ಯಾರ್ಹತೆ',
  photoLabel: 'ಫೋಟೋ',
  photoHint: 'ಚೌಕಾಕಾರ ಉತ್ತಮ. ಉಳಿಸುವ ಮೊದಲು ತಾನಾಗಿ ಗಾತ್ರ ಬದಲಾಗುತ್ತದೆ.',
  removePhoto: 'ಫೋಟೋ ತೆಗೆಯಿರಿ',
  saveProfile: 'ಪ್ರೊಫೈಲ್ ಉಳಿಸಿ',
  profileSaved: 'ಪ್ರೊಫೈಲ್ ನವೀಕರಿಸಲಾಗಿದೆ',
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
