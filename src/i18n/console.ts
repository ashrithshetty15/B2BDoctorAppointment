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
  // ---- patient history & documents ----
  visitHistory: string;
  noVisitsYet: string;
  moreVisits: string;
  waited: string;
  remarkLabel: string;
  documents: string;
  addDocument: string;
  chooseFile: string;
  uploadDocument: string;
  documentAdded: string;
  documentRemoved: string;
  removeDocument: string;
  confirmRemoveDocument: string;
  noDocuments: string;
  uploadHintImages: string;
  uploadHintAll: string;
  uploadFailedType: string;
  uploadFailedSize: string;
  uploadFailedTooMany: string;
  uploadFailedGeneric: string;
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
  /** Queue sections. */
  sectionInRoom: string;
  sectionWaiting: string;
  sectionExpected: string;
  sectionClosed: string;
  /** Shown for a BOOKED patient instead of a waiting timer. */
  expectedAt: (time: string) => string;
  lateBy: (elapsed: string) => string;
  viaWalkIn: string;
  moreActions: string;
  waitingNone: string;
  expectedNone: string;
  viewingAs: string;
  waitingRoomBoard: string;
  waitingRoomBoardBody: string;
  openBoard: string;
  clinicDetails: string;
  bookingConfig: string;
  workingHours: string;
  // ---- weekday names (no keys existed before; settingsView hardcoded English) ----
  dayMon: string;
  dayTue: string;
  dayWed: string;
  dayThu: string;
  dayFri: string;
  daySat: string;
  daySun: string;
  // ---- doctor-editable hours ----
  editHours: string;
  hoursHint: string;
  hoursExample: string;
  saveHours: string;
  hoursSaved: string;
  hoursClashTitle: string;
  hoursClashBody: string;
  // ---- follow-ups ----
  followUp: string;
  followUpSub: string;
  followUpListSub: string;
  setFollowUp: string;
  followUpSet: (date: string) => string;
  followUpCleared: string;
  clearFollowUp: string;
  followUpDue: string;
  followUpUpcoming: string;
  noFollowUps: string;
  followUpPending: string;
  followUpSentOn: (date: string) => string;
  followUpNotSending: string;
  /** Did the reminders work? Three numbers, narrowing. */
  followUpResults: string;
  followUpResultsSub: (days: number) => string;
  followUpSent: string;
  followUpTapped: string;
  followUpBooked: string;
  followUpNoneYet: string;
  followUpFeeLabel: string;
  followUpWorth: (amount: string) => string;
  followUpWorthNote: string;
  followUpDueOn: (date: string) => string;
  followUpVisited: (date: string) => string;
  orPickDate: string;
  // ---- cancelling selected patients ----
  cancelSelected: string;
  cancelSelectedSub: string;
  cancelNBookings: (n: number) => string;
  cancelTheseConfirm: string;
  nothingSelected: string;
  bookingsCancelled: (n: number) => string;
  selectToCancel: string;
  // ---- closing a day ----
  timeOff: string;
  timeOffSub: string;
  closeDay: string;
  closeToday: string;
  closeTodaySub: string;
  closeDayFor: (date: string) => string;
  closeDayConfirm: string;
  cancelsBookings: (n: number) => string;
  nothingBooked: string;
  willBeMessaged: (n: number) => string;
  cannotBeMessaged: (n: number) => string;
  cannotBeMessagedWhy: string;
  dayClosed: string;
  dayClosedSub: (n: number) => string;
  callThesePatients: string;
  everyoneNotified: string;
  reopenDay: string;
  reopenWarning: string;
  dayReopened: string;
  noTimeOff: string;
  onLeaveThatDay: string;
  pastDate: string;
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
  /** Shown when the provider is refusing to deliver this clinic's messages. */
  channelBlocked: string;
  channelLimited: string;
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
  visitHistory: 'Visit history',
  noVisitsYet: 'No visits recorded yet.',
  moreVisits: 'older visits not shown',
  waited: 'waited',
  remarkLabel: 'Remark',
  documents: 'Documents',
  addDocument: 'Add document',
  chooseFile: 'Choose a file',
  uploadDocument: 'Upload',
  documentAdded: 'Document added',
  documentRemoved: 'Document removed',
  removeDocument: 'Remove',
  confirmRemoveDocument: 'Remove this document? This cannot be undone.',
  noDocuments: 'No documents for this visit.',
  uploadHintImages: 'Photos only (JPG, PNG, WebP), up to {size}.',
  uploadHintAll: 'Photos or PDF, up to {size}.',
  uploadFailedType: 'That file type is not accepted.',
  uploadFailedSize: 'That file is too large.',
  uploadFailedTooMany: 'This visit already has the maximum number of documents.',
  uploadFailedGeneric: 'That file could not be uploaded.',
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
  noSlotsBody: 'Working hours for this day are empty, or the clinic is closed. Set your hours in Settings.',
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
  sectionInRoom: 'In room',
  sectionWaiting: 'Waiting',
  sectionExpected: 'Expected today',
  sectionClosed: 'Done / No-show',
  expectedAt: (time) => `Expected ${time}`,
  lateBy: (elapsed) => `Late by ${elapsed}`,
  viaWalkIn: 'Walk-in',
  moreActions: 'More',
  waitingNone: 'Nobody in the waiting room',
  expectedNone: 'Nobody else expected today',
  viewingAs: 'Viewing as',
  waitingRoomBoard: 'Waiting-room screen',
  waitingRoomBoardBody:
    'Open this on a TV or a spare tablet in the waiting room. It shows the token being seen now — never a patient name. Anyone with the link can view it, so keep it off social media.',
  openBoard: 'Open the screen',
  clinicDetails: 'Clinic',
  bookingConfig: 'Booking',
  workingHours: 'Working hours',
  dayMon: 'Monday',
  dayTue: 'Tuesday',
  dayWed: 'Wednesday',
  dayThu: 'Thursday',
  dayFri: 'Friday',
  daySat: 'Saturday',
  daySun: 'Sunday',
  editHours: 'Edit working hours',
  hoursHint: 'Leave a day blank to close it. Separate a morning and evening session with a comma.',
  hoursExample: 'e.g. 09:30-13:00, 17:00-20:00',
  saveHours: 'Save hours',
  hoursSaved: 'Working hours saved',
  hoursClashTitle: 'These hours would leave existing bookings outside your working time',
  hoursClashBody: 'Close those days or move the bookings first, then change your hours.',
  followUp: 'Follow-up',
  followUpSub: 'When should this patient come back?',
  followUpListSub: 'Patients you have asked to come back.',
  setFollowUp: 'Set follow-up',
  followUpSet: (date) => `Follow-up set for ${date}`,
  followUpCleared: 'Follow-up removed',
  clearFollowUp: 'Remove',
  followUpDue: 'Due now',
  followUpUpcoming: 'Coming up',
  noFollowUps: 'No follow-ups yet. Set one while you are with a patient.',
  followUpPending: 'Not sent yet',
  followUpSentOn: (date) => `Reminded ${date}`,
  followUpResults: 'Did the reminders work?',
  followUpResultsSub: (days) => `Last ${days} days`,
  followUpSent: 'Reminders sent',
  followUpTapped: 'Tapped to book',
  followUpBooked: 'Came back',
  followUpNoneYet: 'Nothing to show yet — this fills in once reminders start going out.',
  followUpFeeLabel: 'Your consult fee',
  followUpWorth: (amount) => `About ${amount} of return visits`,
  followUpWorthNote:
    'Counts a patient who tapped the reminder and booked within 30 days, not counting cancellations. Someone who phoned instead is not counted, so the real figure is a little higher.',
  followUpNotSending: 'Follow-up reminders cannot send yet: WhatsApp needs an approved template for messages sent more than 24 hours after a patient last wrote to you. Until then, please call these patients.',
  followUpDueOn: (date) => `Due ${date}`,
  followUpVisited: (date) => `Seen ${date}`,
  orPickDate: 'or pick a date',
  cancelSelected: 'Cancel selected',
  cancelSelectedSub: 'Tick the patients you cannot see today. They are told, and their booking is cancelled.',
  cancelNBookings: (n) => `Cancel ${n} booking${n === 1 ? '' : 's'}`,
  cancelTheseConfirm: 'Cancel these bookings',
  nothingSelected: 'Pick at least one patient first.',
  bookingsCancelled: (n) => `${n} booking${n === 1 ? '' : 's'} cancelled.`,
  selectToCancel: 'Cancel this booking',
  timeOff: 'Time off',
  timeOffSub: 'Close a day so nothing new can be booked, and cancel what already is.',
  closeDay: 'Close this day',
  closeToday: 'Close today',
  closeTodaySub: 'Had an emergency? Cancel the rest of today and stop new bookings.',
  closeDayFor: (date) => `Close ${date}?`,
  closeDayConfirm: 'Close the day',
  cancelsBookings: (n) => `${n} booking${n === 1 ? '' : 's'} will be cancelled.`,
  nothingBooked: 'Nothing is booked that day — closing it just stops new bookings.',
  willBeMessaged: (n) => `${n} patient${n === 1 ? '' : 's'} will be messaged on WhatsApp`,
  cannotBeMessaged: (n) =>
    `${n} patient${n === 1 ? '' : 's'} cannot be messaged — you will get their number${n === 1 ? '' : 's'}`,
  cannotBeMessagedWhy:
    'WhatsApp only allows a message within 24 hours of the patient writing to you. These patients need a phone call.',
  dayClosed: 'Day closed',
  dayClosedSub: (n) => `${n} booking${n === 1 ? '' : 's'} cancelled.`,
  callThesePatients: 'Please call these patients — we could not message them',
  everyoneNotified: 'Every patient was messaged.',
  reopenDay: 'Reopen',
  reopenWarning:
    'Reopening only allows new bookings. Cancelled patients have already been told not to come and are not brought back.',
  dayReopened: 'Day reopened for new bookings',
  noTimeOff: 'No days closed.',
  onLeaveThatDay: 'Already closed',
  pastDate: 'That day has already passed.',
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
  channelBlocked:
    'WhatsApp is not delivering your messages right now, so patients are not receiving booking updates. Please contact your clinic administrator.',
  channelLimited:
    'WhatsApp is limiting how many patients you can message today. Bookings still work.',
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
  visitHistory: 'ಭೇಟಿಯ ಇತಿಹಾಸ',
  noVisitsYet: 'ಇನ್ನೂ ಯಾವುದೇ ಭೇಟಿ ದಾಖಲಾಗಿಲ್ಲ.',
  moreVisits: 'ಹಳೆಯ ಭೇಟಿಗಳನ್ನು ತೋರಿಸಿಲ್ಲ',
  waited: 'ಕಾದಿದ್ದು',
  remarkLabel: 'ಟಿಪ್ಪಣಿ',
  documents: 'ದಾಖಲೆಗಳು',
  addDocument: 'ದಾಖಲೆ ಸೇರಿಸಿ',
  chooseFile: 'ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ',
  uploadDocument: 'ಅಪ್‌ಲೋಡ್ ಮಾಡಿ',
  documentAdded: 'ದಾಖಲೆ ಸೇರಿಸಲಾಗಿದೆ',
  documentRemoved: 'ದಾಖಲೆ ತೆಗೆದುಹಾಕಲಾಗಿದೆ',
  removeDocument: 'ತೆಗೆದುಹಾಕಿ',
  confirmRemoveDocument: 'ಈ ದಾಖಲೆಯನ್ನು ತೆಗೆದುಹಾಕಬೇಕೇ? ಇದನ್ನು ಮತ್ತೆ ಪಡೆಯಲು ಆಗುವುದಿಲ್ಲ.',
  noDocuments: 'ಈ ಭೇಟಿಗೆ ಯಾವುದೇ ದಾಖಲೆ ಇಲ್ಲ.',
  uploadHintImages: 'ಫೋಟೋ ಮಾತ್ರ (JPG, PNG, WebP), {size} ವರೆಗೆ.',
  uploadHintAll: 'ಫೋಟೋ ಅಥವಾ PDF, {size} ವರೆಗೆ.',
  uploadFailedType: 'ಈ ಬಗೆಯ ಫೈಲ್ ಸ್ವೀಕರಿಸುವುದಿಲ್ಲ.',
  uploadFailedSize: 'ಈ ಫೈಲ್ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ.',
  uploadFailedTooMany: 'ಈ ಭೇಟಿಗೆ ಈಗಾಗಲೇ ಗರಿಷ್ಠ ಸಂಖ್ಯೆಯ ದಾಖಲೆಗಳಿವೆ.',
  uploadFailedGeneric: 'ಈ ಫೈಲ್ ಅಪ್‌ಲೋಡ್ ಮಾಡಲು ಆಗಲಿಲ್ಲ.',
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
  sectionInRoom: 'ಕೊಠಡಿಯಲ್ಲಿ',
  sectionWaiting: 'ಕಾಯುತ್ತಿದ್ದಾರೆ',
  sectionExpected: 'ಇಂದು ಬರಬೇಕಾದವರು',
  sectionClosed: 'ಮುಗಿದಿದೆ / ಬರಲಿಲ್ಲ',
  expectedAt: (time) => `${time} ಕ್ಕೆ ನಿರೀಕ್ಷಿತ`,
  lateBy: (elapsed) => `${elapsed} ತಡ`,
  viaWalkIn: 'ನೇರ ಬಂದವರು',
  moreActions: 'ಹೆಚ್ು',
  waitingNone: 'ಕಾಯುವ ಕೋಣೆಯಲ್ಲಿ ಯಾರೂ ಇಲ್ಲ',
  expectedNone: 'ಇಂದು ಬೇರೆ ಯಾರೂ ನಿರೀಕ್ಷಿತ ಇಲ್ಲ',
  viewingAs: 'ನೋಡುತ್ತಿರುವುದು',
  waitingRoomBoard: 'ಕಾಯುವ ಕೋಣೆಯ ಪರಮೆ',
  waitingRoomBoardBody:
    'ಇದನ್ನು ಕಾಯುವ ಕೋಣೆಯ TV ಅಥವಾ ಟ್ಯಾಬ್ಲೆಟ್‌ನಲ್ಲಿ ತೆರೆಯಿರಿ. ಈಗ ನಡೆಯುತ್ತಿರುವ ಟೋಕನ್ ಮಾತ್ರ ತೋರಿಸುತ್ತದೆ — ರೋಗಿಯ ಹೆಸರನ್ನು ಅಲ್ಲ. ಲಿಂಕ್ ಇರುವ ಯಾರು ಬೇಕಾದರೂ ನೋಡಬಹುದು.',
  openBoard: 'ಪರಮೆ ತೆರೆಯಿರಿ',
  clinicDetails: 'ಕ್ಲಿನಿಕ್',
  bookingConfig: 'ಬುಕಿಂಗ್',
  workingHours: 'ಕೆಲಸದ ಸಮಯ',
  dayMon: 'ಸೋಮವಾರ',
  dayTue: 'ಮಂಗಳವಾರ',
  dayWed: 'ಬುಧವಾರ',
  dayThu: 'ಗುರುವಾರ',
  dayFri: 'ಶುಕ್ರವಾರ',
  daySat: 'ಶನಿವಾರ',
  daySun: 'ಭಾನುವಾರ',
  editHours: 'ಕೆಲಸದ ಸಮಯ ಬದಲಾಯಿಸಿ',
  hoursHint: 'ದಿನವನ್ನು ಮುಚ್ಚಲು ಖಾಲಿ ಬಿಡಿ. ಬೆಳಿಗ್ಗೆ ಮತ್ತು ಸಂಜೆಯ ಸಮಯವನ್ನು ಅಲ್ಪವಿರಾಮದಿಂದ ಬೇರ್ಪಡಿಸಿ.',
  hoursExample: 'ಉದಾ. 09:30-13:00, 17:00-20:00',
  saveHours: 'ಸಮಯ ಉಳಿಸಿ',
  hoursSaved: 'ಕೆಲಸದ ಸಮಯ ಉಳಿಸಲಾಗಿದೆ',
  hoursClashTitle: 'ಈ ಸಮಯದಿಂದ ಈಗಾಗಲೇ ಇರುವ ಕೆಲವು ಬುಕಿಂಗ್‌ಗಳು ಕೆಲಸದ ಸಮಯದ ಹೊರಗೆ ಉಳಿಯುತ್ತವೆ',
  hoursClashBody: 'ಮೊದಲು ಆ ದಿನಗಳನ್ನು ಮುಚ್ಚಿ ಅಥವಾ ಬುಕಿಂಗ್ ಬದಲಾಯಿಸಿ, ನಂತರ ಸಮಯ ಬದಲಾಯಿಸಿ.',
  followUp: 'ಮರು ಭೇಟಿ',
  followUpSub: 'ಈ ರೋಗಿ ಯಾವಾಗ ಮತ್ತೆ ಬರಬೇಕು?',
  followUpListSub: 'ಮತ್ತೆ ಬರಲು ಹೇಳಿದ ರೋಗಿಗಳು.',
  setFollowUp: 'ಮರು ಭೇಟಿ ಗೊತ್ತುಮಾಡಿ',
  followUpSet: (date) => `${date} ಕ್ಕೆ ಮರು ಭೇಟಿ ಗೊತ್ತುಮಾಡಲಾಗಿದೆ`,
  followUpCleared: 'ಮರು ಭೇಟಿ ತೆಗೆದುಹಾಕಲಾಗಿದೆ',
  clearFollowUp: 'ತೆಗೆದುಹಾಕಿ',
  followUpDue: 'ಈಗ ಬರಬೇಕಾದವರು',
  followUpUpcoming: 'ಮುಂದೆ ಬರಬೇಕಾದವರು',
  noFollowUps: 'ಇನ್ನೂ ಯಾವುದೇ ಮರು ಭೇಟಿ ಇಲ್ಲ. ರೋಗಿಯ ಜೊತೆ ಇರುವಾಗಲೇ ಗೊತ್ತುಮಾಡಿ.',
  followUpPending: 'ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ',
  followUpSentOn: (date) => `${date} ರಂದು ನೆನಪಿಸಲಾಗಿದೆ`,
  followUpResults: 'ನೆನಪುಗಳು ಕೆಲಸ ಮಾಡಿದವೇ?',
  followUpResultsSub: (days) => `ಕಳೆದ ${days} ದಿನಗಳು`,
  followUpSent: 'ಕಳುಹಿಸಿದ ನೆನಪುಗಳು',
  followUpTapped: 'ಬುಕ್ ಮಾಡಲು ಒತ್ತಿದವರು',
  followUpBooked: 'ಮತ್ತೆ ಬಂದವರು',
  followUpNoneYet: 'ಇನ್ನೂ ತೋರಿಸಲು ಏನೂ ಇಲ್ಲ — ನೆನಪುಗಳು ಹೋಗಲು ಶುರುವಾದ ಮೇಲೆ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.',
  followUpFeeLabel: 'ನಿಮ್ಮ ಸಲಹಾ ಶುಲ್ಕ',
  followUpWorth: (amount) => `ಸುಮಾರು ${amount} ಮೌಲ್ಯದ ಮರು ಭೇಟಿಗಳು`,
  followUpWorthNote:
    'ನೆನಪು ಒತ್ತಿ 30 ದಿನಗಳ ಒಳಗೆ ಬುಕ್ ಮಾಡಿದವರನ್ನು ಮಾತ್ರ ಎಣಿಸಲಾಗಿದೆ; ರದ್ದಾದವನ್ನು ಬಿಡಲಾಗಿದೆ. ಬದಲಿಗೆ ಫೋನ್ ಮಾಡಿದವರು ಇದರಲ್ಲಿ ಇಲ್ಲ, ಹಾಗಾಗಿ ನಿಜವಾದ ಸಂಖ್ಯೆ ಸ್ವಲ್ಪ ಹೆಚ್ಚು.',
  followUpNotSending: 'ಮರು ಭೇಟಿಯ ನೆನಪು ಇನ್ನೂ ಕಳುಹಿಸಲು ಆಗುವುದಿಲ್ಲ: ರೋಗಿ ಕೊನೆಯ ಬಾರಿ ಬರೆದು 24 ಗಂಟೆ ಕಳೆದ ಮೇಲೆ ಸಂದೇಶ ಕಳುಹಿಸಲು ವಾಟ್ಸಾಪ್‌ಗೆ ಅನುಮೋದಿತ ಟೆಂಪ್ಲೇಟ್ ಬೇಕು. ಅಲ್ಲಿಯವರೆಗೆ ಈ ರೋಗಿಗಳಿಗೆ ಫೋನ್ ಮಾಡಿ.',
  followUpDueOn: (date) => `${date} ಕ್ಕೆ ಬರಬೇಕು`,
  followUpVisited: (date) => `${date} ರಂದು ನೋಡಿದ್ದು`,
  orPickDate: 'ಅಥವಾ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ',
  cancelSelected: 'ಆಯ್ಕೆ ಮಾಡಿದವನ್ನು ರದ್ದುಮಾಡಿ',
  cancelSelectedSub: 'ಇವತ್ತು ನೋಡಲು ಆಗದ ರೋಗಿಗಳನ್ನು ಗುರುತಿಸಿ. ಅವರಿಗೆ ತಿಳಿಸಲಾಗುತ್ತದೆ ಮತ್ತು ಬುಕಿಂಗ್ ರದ್ದಾಗುತ್ತದೆ.',
  cancelNBookings: (n) => `${n} ಬುಕಿಂಗ್ ರದ್ದುಮಾಡಿ`,
  cancelTheseConfirm: 'ಈ ಬುಕಿಂಗ್‌ಗಳನ್ನು ರದ್ದುಮಾಡಿ',
  nothingSelected: 'ಮೊದಲು ಒಬ್ಬ ರೋಗಿಯನ್ನಾದರೂ ಆಯ್ಕೆ ಮಾಡಿ.',
  bookingsCancelled: (n) => `${n} ಬುಕಿಂಗ್ ರದ್ದುಮಾಡಲಾಗಿದೆ.`,
  selectToCancel: 'ಈ ಬುಕಿಂಗ್ ರದ್ದುಮಾಡಿ',
  timeOff: 'ರಜೆ',
  timeOffSub: 'ಹೊಸ ಬುಕಿಂಗ್ ನಿಲ್ಲಿಸಲು ದಿನವನ್ನು ಮುಚ್ಚಿ, ಮತ್ತು ಇರುವ ಬುಕಿಂಗ್ ರದ್ದುಮಾಡಿ.',
  closeDay: 'ಈ ದಿನ ಮುಚ್ಚಿ',
  closeToday: 'ಇವತ್ತು ಮುಚ್ಚಿ',
  closeTodaySub: 'ತುರ್ತು ಬಂತೇ? ಇವತ್ತಿನ ಉಳಿದ ಬುಕಿಂಗ್ ರದ್ದುಮಾಡಿ ಮತ್ತು ಹೊಸದನ್ನು ನಿಲ್ಲಿಸಿ.',
  closeDayFor: (date) => `${date} ಮುಚ್ಚಬೇಕೇ?`,
  closeDayConfirm: 'ದಿನ ಮುಚ್ಚಿ',
  cancelsBookings: (n) => `${n} ಬುಕಿಂಗ್ ರದ್ದಾಗುತ್ತದೆ.`,
  nothingBooked: 'ಆ ದಿನ ಯಾವುದೇ ಬುಕಿಂಗ್ ಇಲ್ಲ — ಮುಚ್ಚಿದರೆ ಹೊಸ ಬುಕಿಂಗ್ ಮಾತ್ರ ನಿಲ್ಲುತ್ತದೆ.',
  willBeMessaged: (n) => `${n} ರೋಗಿಗೆ ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಸಂದೇಶ ಹೋಗುತ್ತದೆ`,
  cannotBeMessaged: (n) => `${n} ರೋಗಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಲು ಆಗುವುದಿಲ್ಲ — ಅವರ ನಂಬರ್ ನಿಮಗೆ ಸಿಗುತ್ತದೆ`,
  cannotBeMessagedWhy:
    'ರೋಗಿ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿದ 24 ಗಂಟೆಯೊಳಗೆ ಮಾತ್ರ ವಾಟ್ಸಾಪ್ ಸಂದೇಶಕ್ಕೆ ಅವಕಾಶ ಕೊಡುತ್ತದೆ. ಇವರಿಗೆ ಫೋನ್ ಮಾಡಬೇಕು.',
  dayClosed: 'ದಿನ ಮುಚ್ಚಲಾಗಿದೆ',
  dayClosedSub: (n) => `${n} ಬುಕಿಂಗ್ ರದ್ದುಮಾಡಲಾಗಿದೆ.`,
  callThesePatients: 'ಈ ರೋಗಿಗಳಿಗೆ ಫೋನ್ ಮಾಡಿ — ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಲು ಆಗಲಿಲ್ಲ',
  everyoneNotified: 'ಎಲ್ಲಾ ರೋಗಿಗಳಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಲಾಗಿದೆ.',
  reopenDay: 'ಮತ್ತೆ ತೆರೆಯಿರಿ',
  reopenWarning:
    'ಮತ್ತೆ ತೆರೆದರೆ ಹೊಸ ಬುಕಿಂಗ್ ಮಾತ್ರ ಸಾಧ್ಯ. ರದ್ದಾದ ರೋಗಿಗಳಿಗೆ ಈಗಾಗಲೇ ಬರಬೇಡಿ ಎಂದು ತಿಳಿಸಲಾಗಿದೆ, ಅವರನ್ನು ಮರಳಿ ಸೇರಿಸುವುದಿಲ್ಲ.',
  dayReopened: 'ಹೊಸ ಬುಕಿಂಗ್‌ಗೆ ದಿನ ಮತ್ತೆ ತೆರೆಯಲಾಗಿದೆ',
  noTimeOff: 'ಯಾವುದೇ ದಿನ ಮುಚ್ಚಿಲ್ಲ.',
  onLeaveThatDay: 'ಈಗಾಗಲೇ ಮುಚ್ಚಲಾಗಿದೆ',
  pastDate: 'ಆ ದಿನ ಈಗಾಗಲೇ ಕಳೆದಿದೆ.',
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
  channelBlocked:
    'ಸದ್ಯಕ್ಕೆ ವಾಟ್ಸಾಪ್ ನಿಮ್ಮ ಸಂದೇಶಗಳನ್ನು ತಲುಪಿಸುತ್ತಿಲ್ಲ, ಹಾಗಾಗಿ ರೋಗಿಗಳಿಗೆ ಬುಕಿಂಗ್ ಮಾಹಿತಿ ಸಿಗುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಕ್ಲಿನಿಕ್ ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  channelLimited:
    'ಇವತ್ತು ಎಷ್ಟು ರೋಗಿಗಳಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಬಹುದು ಎಂಬುದನ್ನು ವಾಟ್ಸಾಪ್ ಮಿತಿಗೊಳಿಸಿದೆ. ಬುಕಿಂಗ್ ಎಂದಿನಂತೆ ನಡೆಯುತ್ತದೆ.',
};

export const consoleStrings: Record<Language, ConsoleStrings> = { EN: en, KN: kn };

export function c(language: Language): ConsoleStrings {
  return consoleStrings[language] ?? en;
}

/** Compact elapsed label: "4 min", "1 hr 20 min". Kept short for dense rows. */
export function elapsed(from: Date, language: Language, now: Date = new Date()): string {
  return formatMins(Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000)), language);
}

/**
 * A duration already measured, rather than one running against the clock.
 *
 * Needed because a patient in the room has *finished* waiting: rendering their
 * wait as "time since arrival" kept it ticking up while they were with the
 * doctor.
 */
export function formatMins(mins: number, language: Language): string {
  const isKn = language === 'KN';
  if (mins < 1) return isKn ? 'ಈಗಷ್ಟೇ' : 'just now';
  if (mins < 60) return `${mins} ${isKn ? 'ನಿಮಿಷ' : 'min'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hrs = `${h} ${isKn ? 'ಗಂಟೆ' : 'hr'}`;
  return m === 0 ? hrs : `${hrs} ${m} ${isKn ? 'ನಿಮಿಷ' : 'min'}`;
}
