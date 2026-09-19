import type { Language } from '@prisma/client';

/**
 * Every patient-facing string lives here, keyed by {language}.{templateName}.
 * Business logic never concatenates copy — it calls `t(lang, 'name', params)`.
 *
 * Adding a language = add one object below. Adding a template = add it to
 * `TemplateSet`; TypeScript then forces every language to implement it, so a
 * language can never silently fall out of sync.
 *
 * Kannada (KN) is served in native Kannada script. Patients still frequently
 * reply in Latin script, so `conversation/intent.ts` matches keywords in both
 * scripts; menu digits stay ASCII for the same reason.
 */

export type TemplateSet = {
  // ---- shared / onboarding ----
  languagePrompt: () => string;
  languageInvalid: () => string;
  askName: (p: { clinicName: string }) => string;
  nameInvalid: () => string;
  welcomeBack: (p: { patientName: string; clinicName: string }) => string;
  sessionExpired: () => string;
  errorGeneric: () => string;
  unknownInput: () => string;
  selectDoctor: () => string;
  /** Shown where the Cancel button gave up its place to Change doctor. */
  slotCancelHint: () => string;
  selectDoctorInvalid: () => string;
  btnChooseDoctor: () => string;
  doctorOnLeave: (p: { doctorName: string; date: string }) => string;
  notConfigured: () => string;
  /** Substituted for the "now serving" value before the day's first consult. */
  nowServingNone: () => string;

  // ---- TOKEN mode ----
  tokenMainMenu: (p: { doctorName: string; date: string }) => string;
  tokenConfirmPrompt: (p: { doctorName: string; date: string }) => string;
  tokenBooked: (p: {
    tokenNumber: number;
    date: string;
    doctorName: string;
    nowServing: string;
    ahead: number;
    eta: string;
  }) => string;
  tokenAlreadyBooked: (p: { tokenNumber: number; ahead: number; eta: string }) => string;
  tokenQueueFull: (p: { doctorName: string }) => string;
  tokenListClosed: () => string;
  tokenStatus: (p: {
    tokenNumber: number;
    nowServing: string;
    ahead: number;
    eta: string;
  }) => string;
  tokenPositionUpdate: (p: {
    tokenNumber: number;
    nowServing: string;
    ahead: number;
    eta: string;
  }) => string;
  tokenUpNext: (p: { tokenNumber: number }) => string;
  tokenYourTurn: (p: { tokenNumber: number; doctorName: string }) => string;
  tokenCancelConfirm: (p: { tokenNumber: number; date: string }) => string;
  tokenCancelled: (p: { tokenNumber: number }) => string;
  tokenCancelAborted: () => string;
  tokenNoActiveBooking: () => string;
  tokenDelayBroadcast: (p: { doctorName: string; delayMins: number; eta: string }) => string;
  tokenVisitDone: (p: { doctorName: string }) => string;
  tokenNoShow: (p: { tokenNumber: number }) => string;
  tokenBookingCancelledByClinic: (p: { tokenNumber: number; date: string }) => string;

  // ---- SLOT mode ----
  slotMainMenu: (p: { doctorName: string }) => string;
  slotPickDate: () => string;
  slotPickPeriod: (p: { date: string }) => string;
  slotPickTime: (p: { date: string }) => string;
  slotNoneAvailable: (p: { date: string }) => string;
  /** Nothing free on any day searched — distinct from one day being full. */
  slotNothingAvailable: () => string;
  slotConfirmPrompt: (p: { doctorName: string; date: string; time: string }) => string;
  slotBooked: (p: { doctorName: string; clinicName: string; date: string; time: string }) => string;
  /** Appended only when both reminders will really be sent. */
  slotRemindBoth: () => string;
  /** When the appointment is too soon for an evening-before reminder. */
  slotRemindHour: () => string;
  slotCancelNote: () => string;
  slotAlreadyBooked: (p: { date: string; time: string }) => string;
  slotMoveConfirm: (p: { doctorName: string; date: string; fromTime: string; toTime: string }) => string;
  slotMoved: (p: { doctorName: string; clinicName: string; date: string; time: string }) => string;
  slotMoveKept: (p: { date: string; time: string }) => string;
  slotTaken: () => string;
  slotStatus: (p: { doctorName: string; date: string; time: string }) => string;
  slotCancelConfirm: (p: { date: string; time: string }) => string;
  slotCancelled: (p: { date: string; time: string }) => string;
  slotReminderDayBefore: (p: {
    doctorName: string;
    clinicName: string;
    date: string;
    time: string;
  }) => string;
  slotReminderHourBefore: (p: { doctorName: string; time: string }) => string;
  slotDelayBroadcast: (p: { doctorName: string; delayMins: number }) => string;
  slotInvalidChoice: () => string;

  // ---- HYBRID mode ----
  /**
   * Short labels for tappable reply buttons. Kept separate from the message
   * bodies because Meta clips a button title around 20 characters, while a body
   * line is written to be read.
   *
   * The bodies no longer spell the options out as a numbered list. The buttons
   * already carry the same words, so the list was the message repeating itself
   * and it made every menu several lines longer on a phone. Typed numbers still
   * work — menuIntent never stopped reading them — they are simply not
   * advertised.
   */
  btnEnglish: () => string;
  btnKannada: () => string;
  btnBookToken: () => string;
  btnMyStatus: () => string;
  btnCancelToken: () => string;
  btnBookSlot: () => string;
  btnMyAppointment: () => string;
  btnCancelSlot: () => string;
  btnChangeDoctor: () => string;
  btnChooseDate: () => string;
  btnChooseTime: () => string;
  btnMoreTimes: () => string;
  btnMorning: () => string;
  btnAfternoon: () => string;
  btnEvening: () => string;
  btnYes: () => string;
  btnNo: () => string;
  /**
   * Cancelling asks its own question, so it needs its own answers. "Yes,
   * confirm" on a cancel prompt reads as confirming the booking, which is the
   * opposite of what the tap does.
   */
  btnYesCancel: () => string;
  btnKeepIt: () => string;

  hybridModeChoice: (p: { doctorName: string }) => string;
};

const en: TemplateSet = {
  languagePrompt: () =>
    'Welcome! Please choose your language.',
  languageInvalid: () => 'Please choose English or ಕನ್ನಡ below.',
  askName: ({ clinicName }) =>
    `Welcome to ${clinicName}. What is your name? (Please type your full name)`,
  nameInvalid: () => 'Please type your name using at least 2 letters.',
  welcomeBack: ({ patientName, clinicName }) => `Welcome back, ${patientName}! — ${clinicName}`,
  sessionExpired: () => 'Your session timed out, so we are starting again.',
  errorGeneric: () =>
    'Sorry, something went wrong on our side. Please try again in a moment, or call the clinic.',
  unknownInput: () => 'Sorry, I did not understand that. Please reply with one of the numbers shown above.',
  selectDoctor: () => 'Which doctor would you like to see?',
  slotCancelHint: () => '_Reply *cancel* to cancel your appointment._',
  selectDoctorInvalid: () => 'Please choose one of the doctors shown above.',
  btnChooseDoctor: () => 'Choose a doctor',
  doctorOnLeave: ({ doctorName, date }) =>
    `Dr. ${doctorName} is not available on ${date}. Please try another day.`,
  notConfigured: () =>
    'This clinic is not set up for WhatsApp booking yet. Please call the clinic directly.',
  nowServingNone: () => 'not started yet',

  // ---- TOKEN mode ----
  tokenMainMenu: ({ doctorName, date }) =>
    `Dr. ${doctorName} — ${date}\n\nHow can we help you today?`,
  tokenConfirmPrompt: ({ doctorName, date }) =>
    `Book a token with Dr. ${doctorName} for ${date}?`,
  tokenBooked: ({ tokenNumber, date, doctorName, nowServing, ahead, eta }) =>
    `Your token is confirmed.\n\n*Token #${tokenNumber}*\nDr. ${doctorName} — ${date}\nNow serving: ${nowServing}\nPatients ahead of you: ${ahead}\nApprox. wait: ${eta}\n\nWe will message you as the queue moves. Reply *status* anytime to check yours.`,
  tokenAlreadyBooked: ({ tokenNumber, ahead, eta }) =>
    `You already have *token #${tokenNumber}* for today.\nPatients ahead of you: ${ahead}\nApprox. wait: ${eta}`,
  tokenQueueFull: ({ doctorName }) =>
    `Sorry, all tokens for Dr. ${doctorName} are booked for today. Please message us tomorrow morning.`,
  tokenListClosed: () => 'Token booking is closed for today. Please try again tomorrow.',
  tokenStatus: ({ tokenNumber, nowServing, ahead, eta }) =>
    `*Token #${tokenNumber}*\nNow serving: ${nowServing}\nPatients ahead of you: ${ahead}\nApprox. wait: ${eta}`,
  tokenPositionUpdate: ({ tokenNumber, nowServing, ahead, eta }) =>
    `Queue update — *token #${tokenNumber}*\nNow serving: ${nowServing}\nPatients ahead of you: ${ahead}\nApprox. wait: ${eta}`,
  tokenUpNext: ({ tokenNumber }) =>
    `You are next! *Token #${tokenNumber}* — please reach the clinic and wait outside the doctor's room.`,
  tokenYourTurn: ({ tokenNumber, doctorName }) =>
    `It's your turn now. *Token #${tokenNumber}* — please go in to see Dr. ${doctorName}.`,
  tokenCancelConfirm: ({ tokenNumber, date }) =>
    `Cancel *token #${tokenNumber}* for ${date}?`,
  tokenCancelled: ({ tokenNumber }) =>
    `Token #${tokenNumber} has been cancelled. Message us anytime to book again.`,
  tokenCancelAborted: () => 'Your token has been kept. Nothing was cancelled.',
  tokenNoActiveBooking: () =>
    'You do not have an active token for today. Reply *book* to take one.',
  tokenDelayBroadcast: ({ doctorName, delayMins, eta }) =>
    `Update: Dr. ${doctorName} is running about ${delayMins} mins late today. Sorry for the inconvenience.\nYour new approx. wait: ${eta}`,
  tokenVisitDone: ({ doctorName }) =>
    `Thank you for visiting Dr. ${doctorName}. Wishing you a speedy recovery. Message us anytime to book again.`,
  tokenNoShow: ({ tokenNumber }) =>
    `Token #${tokenNumber} was called but you were not present, so it has been marked as missed. Reply *book* to take a fresh token.`,
  tokenBookingCancelledByClinic: ({ tokenNumber, date }) =>
    `Sorry — your *token #${tokenNumber}* for ${date} has been cancelled as the doctor is unavailable. Please book again for another day.`,

  // ---- SLOT mode ----
  // The options used to be repeated as a numbered list in the body. The buttons
  // below already say the same thing, so the text said everything twice and the
  // message was three times longer than it needed to be. The numbers still work
  // as input for anyone who types them.
  slotMainMenu: ({ doctorName }) => `Dr. ${doctorName}\n\nHow can we help you today?`,
  slotPickDate: () => 'Which day would you like to come in?',
  slotPickPeriod: ({ date }) => `${date}\n\nWhat time of day suits you?`,
  slotPickTime: ({ date }) => `Available times on ${date} — pick one below.`,
  slotNoneAvailable: ({ date }) =>
    `Sorry, no appointment times are free on ${date}. Please choose another date.`,
  slotNothingAvailable: () =>
    'Sorry, all appointments are booked at the moment. Please try again tomorrow.',
  slotConfirmPrompt: ({ doctorName, date, time }) =>
    `Confirm your appointment?\n\nDr. ${doctorName}\n*${date} at ${time}*`,
  slotBooked: ({ doctorName, clinicName, date, time }) =>
    `Your appointment is confirmed.\n\nDr. ${doctorName} — ${clinicName}\n*${date} at ${time}*`,
  slotRemindBoth: () => 'We will remind you the evening before and again 1 hour ahead.',
  slotRemindHour: () => 'We will remind you 1 hour before.',
  slotCancelNote: () => 'Reply *cancel* if you cannot make it.',
  slotAlreadyBooked: ({ date, time }) =>
    `You are already booked for *${date} at ${time}*.`,
  slotMoveConfirm: ({ doctorName, date, fromTime, toTime }) =>
    `You already have an appointment with Dr. ${doctorName} on *${date} at ${fromTime}*.

Move it to *${toTime}*?`,
  slotMoved: ({ doctorName, clinicName, date, time }) =>
    `Your appointment has been moved.

Dr. ${doctorName} — ${clinicName}
*${date} at ${time}*

Reply *cancel* if you cannot make it.`,
  slotMoveKept: ({ date, time }) =>
    `No change — your appointment is still *${date} at ${time}*.`,
  slotTaken: () => 'Sorry, that time was just taken. Please pick another one.',
  slotStatus: ({ doctorName, date, time }) =>
    `Your appointment:\nDr. ${doctorName}\n*${date} at ${time}*`,
  slotCancelConfirm: ({ date, time }) =>
    `Cancel your appointment on ${date} at ${time}?`,
  slotCancelled: ({ date, time }) =>
    `Your appointment on ${date} at ${time} has been cancelled. Message us anytime to book again.`,
  slotReminderDayBefore: ({ doctorName, clinicName, date, time }) =>
    `Reminder: you have an appointment with Dr. ${doctorName} at ${clinicName} tomorrow, *${date} at ${time}*. Reply *cancel* if you cannot make it.`,
  slotReminderHourBefore: ({ doctorName, time }) =>
    `Reminder: your appointment with Dr. ${doctorName} is at *${time}* — about 1 hour from now. Please start for the clinic.`,
  slotDelayBroadcast: ({ doctorName, delayMins }) =>
    `Update: Dr. ${doctorName} is running about ${delayMins} mins late today. Please plan your arrival accordingly. Sorry for the inconvenience.`,
  slotInvalidChoice: () => 'Please pick one of the options above.',

  // ---- HYBRID mode ----
  btnEnglish: () => 'English',
  btnKannada: () => 'ಕನ್ನಡ',
  btnBookToken: () => 'Book a token',
  btnMyStatus: () => 'My token status',
  btnCancelToken: () => 'Cancel my token',
  btnBookSlot: () => 'Book appointment',
  btnMyAppointment: () => 'My appointment',
  btnCancelSlot: () => 'Cancel it',
  btnChangeDoctor: () => 'Change doctor',
  btnChooseDate: () => 'Choose a date',
  btnChooseTime: () => 'Choose a time',
  btnMoreTimes: () => 'More times',
  btnMorning: () => 'Morning',
  btnAfternoon: () => 'Afternoon',
  btnEvening: () => 'Evening',
  btnYes: () => 'Yes, confirm',
  btnNo: () => 'No, go back',
  btnYesCancel: () => 'Yes, cancel it',
  btnKeepIt: () => 'No, keep it',

  hybridModeChoice: ({ doctorName }) =>
    `How would you like to see Dr. ${doctorName}?`,
};

const kn: TemplateSet = {
  languagePrompt: () =>
    'ಸ್ವಾಗತ! ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ.',
  languageInvalid: () => 'ದಯವಿಟ್ಟು ಕೆಳಗೆ English ಅಥವಾ ಕನ್ನಡ ಆಯ್ಕೆ ಮಾಡಿ.',
  askName: ({ clinicName }) => `${clinicName} ಗೆ ಸ್ವಾಗತ. ನಿಮ್ಮ ಹೆಸರು ಏನು? (ಪೂರ್ಣ ಹೆಸರು ಬರೆಯಿರಿ)`,
  nameInvalid: () => 'ದಯವಿಟ್ಟು ನಿಮ್ಮ ಹೆಸರನ್ನು ಕನಿಷ್ಠ 2 ಅಕ್ಷರಗಳಲ್ಲಿ ಬರೆಯಿರಿ.',
  welcomeBack: ({ patientName, clinicName }) => `ಮತ್ತೆ ಸ್ವಾಗತ, ${patientName}! — ${clinicName}`,
  sessionExpired: () => 'ನಿಮ್ಮ ಸಂವಾದದ ಸಮಯ ಮುಗಿದಿದೆ, ಆದ್ದರಿಂದ ಮೊದಲಿನಿಂದ ಶುರು ಮಾಡುತ್ತೇವೆ.',
  errorGeneric: () =>
    'ಕ್ಷಮಿಸಿ, ನಮ್ಮ ಕಡೆಯಿಂದ ಏನೋ ತಪ್ಪಾಗಿದೆ. ಸ್ವಲ್ಪ ಹೊತ್ತಿನ ನಂತರ ಪುನಃ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಕ್ಲಿನಿಕ್‌ಗೆ ಫೋನ್ ಮಾಡಿ.',
  unknownInput: () =>
    'ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮೇಲೆ ತೋರಿಸಿರುವ ಸಂಖ್ಯೆಗಳಲ್ಲಿ ಒಂದನ್ನು ಒತ್ತಿ.',
  selectDoctor: () => 'ಯಾವ ವೈದ್ಯರನ್ನು ನೀವು ಭೇಟಿ ಮಾಡಲು ಬಯಸುವಿರಿ?',
  slotCancelHint: () => '_ರದ್ದು ಮಾಡಲು *ರದ್ದು* ಎಂದು ಕಳುಹಿಸಿ._',
  selectDoctorInvalid: () => 'ದಯವಿಟ್ಟು ಮೇಲೆ ತೋರಿಸಿದ ವೈದ್ಯರಲ್ಲಿ ಒಬ್ಬರನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.',
  btnChooseDoctor: () => 'ವೈದ್ಯರನ್ನು ಆಯ್ಕೆಮಾಡಿ',
  doctorOnLeave: ({ doctorName, date }) =>
    `ಡಾ. ${doctorName} ${date} ದಿನ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಬೇರೆ ದಿನ ಪ್ರಯತ್ನಿಸಿ.`,
  notConfigured: () =>
    'ಈ ಕ್ಲಿನಿಕ್ ಇನ್ನೂ WhatsApp ಬುಕಿಂಗ್‌ಗೆ ಸಿದ್ಧವಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್‌ಗೆ ನೇರವಾಗಿ ಫೋನ್ ಮಾಡಿ.',
  nowServingNone: () => 'ಇನ್ನೂ ಶುರುವಾಗಿಲ್ಲ',

  // ---- TOKEN mode ----
  tokenMainMenu: ({ doctorName, date }) =>
    `ಡಾ. ${doctorName} — ${date}\n\nಇಂದು ನಾವು ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?`,
  tokenConfirmPrompt: ({ doctorName, date }) =>
    `ಡಾ. ${doctorName} ಅವರ ಜೊತೆ ${date} ಗೆ ಟೋಕನ್ ಬುಕ್ ಮಾಡಬೇಕೆ?`,
  tokenBooked: ({ tokenNumber, date, doctorName, nowServing, ahead, eta }) =>
    `ನಿಮ್ಮ ಟೋಕನ್ ಖಚಿತವಾಗಿದೆ.\n\n*ಟೋಕನ್ #${tokenNumber}*\nಡಾ. ${doctorName} — ${date}\nಈಗ ನಡೆಯುತ್ತಿರುವ ಟೋಕನ್: ${nowServing}\nನಿಮ್ಮ ಮುಂದೆ ಇರುವ ರೋಗಿಗಳು: ${ahead}\nಅಂದಾಜು ಕಾಯುವ ಸಮಯ: ${eta}\n\nಸರದಿ ಮುಂದೆ ಹೋದಾಗ ನಿಮಗೆ ಸಂದೇಶ ಕಳುಹಿಸುತ್ತೇವೆ. ಸ್ಥಿತಿ ನೋಡಲು ಯಾವಾಗಲಾದರೂ *ಸ್ಥಿತಿ* ಎಂದು ಕಳುಹಿಸಿ.`,
  tokenAlreadyBooked: ({ tokenNumber, ahead, eta }) =>
    `ನಿಮಗೆ ಇವತ್ತಿಗೆ ಈಗಾಗಲೇ *ಟೋಕನ್ #${tokenNumber}* ಇದೆ.\nನಿಮ್ಮ ಮುಂದೆ ಇರುವ ರೋಗಿಗಳು: ${ahead}\nಅಂದಾಜು ಕಾಯುವ ಸಮಯ: ${eta}`,
  tokenQueueFull: ({ doctorName }) =>
    `ಕ್ಷಮಿಸಿ, ಡಾ. ${doctorName} ಅವರ ಇವತ್ತಿನ ಎಲ್ಲಾ ಟೋಕನ್‌ಗಳು ಭರ್ತಿಯಾಗಿವೆ. ದಯವಿಟ್ಟು ನಾಳೆ ಬೆಳಗ್ಗೆ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  tokenListClosed: () => 'ಇವತ್ತಿಗೆ ಟೋಕನ್ ಬುಕಿಂಗ್ ಮುಚ್ಚಲಾಗಿದೆ. ದಯವಿಟ್ಟು ನಾಳೆ ಪ್ರಯತ್ನಿಸಿ.',
  tokenStatus: ({ tokenNumber, nowServing, ahead, eta }) =>
    `*ಟೋಕನ್ #${tokenNumber}*\nಈಗ ನಡೆಯುತ್ತಿರುವ ಟೋಕನ್: ${nowServing}\nನಿಮ್ಮ ಮುಂದೆ ಇರುವ ರೋಗಿಗಳು: ${ahead}\nಅಂದಾಜು ಕಾಯುವ ಸಮಯ: ${eta}`,
  tokenPositionUpdate: ({ tokenNumber, nowServing, ahead, eta }) =>
    `ಸರದಿ ಅಪ್‌ಡೇಟ್ — *ಟೋಕನ್ #${tokenNumber}*\nಈಗ ನಡೆಯುತ್ತಿರುವ ಟೋಕನ್: ${nowServing}\nನಿಮ್ಮ ಮುಂದೆ ಇರುವ ರೋಗಿಗಳು: ${ahead}\nಅಂದಾಜು ಕಾಯುವ ಸಮಯ: ${eta}`,
  tokenUpNext: ({ tokenNumber }) =>
    `ಮುಂದಿನ ಸರದಿ ನಿಮ್ಮದು! *ಟೋಕನ್ #${tokenNumber}* — ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್‌ಗೆ ಬಂದು ಡಾಕ್ಟರ್ ಕೊಠಡಿಯ ಹೊರಗೆ ಕಾಯಿರಿ.`,
  tokenYourTurn: ({ tokenNumber, doctorName }) =>
    `ಈಗ ನಿಮ್ಮ ಸರದಿ. *ಟೋಕನ್ #${tokenNumber}* — ದಯವಿಟ್ಟು ಡಾ. ${doctorName} ಅವರನ್ನು ನೋಡಲು ಒಳಗೆ ಹೋಗಿ.`,
  tokenCancelConfirm: ({ tokenNumber, date }) =>
    `${date} ಗೆ ಇರುವ *ಟೋಕನ್ #${tokenNumber}* ರದ್ದು ಮಾಡಬೇಕೆ?`,
  tokenCancelled: ({ tokenNumber }) =>
    `ಟೋಕನ್ #${tokenNumber} ರದ್ದಾಗಿದೆ. ಮತ್ತೆ ಬುಕ್ ಮಾಡಲು ಯಾವಾಗಲಾದರೂ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  tokenCancelAborted: () => 'ನಿಮ್ಮ ಟೋಕನ್ ಹಾಗೇ ಇದೆ. ಏನೂ ರದ್ದಾಗಿಲ್ಲ.',
  tokenNoActiveBooking: () =>
    'ಇವತ್ತಿಗೆ ನಿಮಗೆ ಯಾವ ಟೋಕನ್ ಕೂಡ ಇಲ್ಲ. ಬುಕ್ ಮಾಡಲು *ಬುಕ್* ಎಂದು ಕಳುಹಿಸಿ.',
  tokenDelayBroadcast: ({ doctorName, delayMins, eta }) =>
    `ಸೂಚನೆ: ಡಾ. ${doctorName} ಇವತ್ತು ಸುಮಾರು ${delayMins} ನಿಮಿಷ ತಡವಾಗಿ ನಡೆಯುತ್ತಿದ್ದಾರೆ. ಅನಾನುಕೂಲಕ್ಕೆ ಕ್ಷಮಿಸಿ.\nನಿಮ್ಮ ಹೊಸ ಅಂದಾಜು ಕಾಯುವ ಸಮಯ: ${eta}`,
  tokenVisitDone: ({ doctorName }) =>
    `ಡಾ. ${doctorName} ಅವರನ್ನು ಭೇಟಿ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ. ಬೇಗ ಗುಣವಾಗಲಿ. ಮತ್ತೆ ಬುಕ್ ಮಾಡಲು ಯಾವಾಗಲಾದರೂ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  tokenNoShow: ({ tokenNumber }) =>
    `ಟೋಕನ್ #${tokenNumber} ಕರೆಯಲಾಯಿತು, ಆದರೆ ನೀವು ಇಲ್ಲದ ಕಾರಣ ಅದನ್ನು ತಪ್ಪಿಸಲಾಗಿದೆ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ. ಹೊಸ ಟೋಕನ್ ಬುಕ್ ಮಾಡಲು *ಬುಕ್* ಎಂದು ಕಳುಹಿಸಿ.`,
  tokenBookingCancelledByClinic: ({ tokenNumber, date }) =>
    `ಕ್ಷಮಿಸಿ — ಡಾಕ್ಟರ್ ಲಭ್ಯವಿಲ್ಲದ ಕಾರಣ ${date} ಗೆ ಇರುವ ನಿಮ್ಮ *ಟೋಕನ್ #${tokenNumber}* ರದ್ದು ಮಾಡಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಬೇರೆ ದಿನಕ್ಕೆ ಮತ್ತೆ ಬುಕ್ ಮಾಡಿ.`,

  // ---- SLOT mode ----
  slotMainMenu: ({ doctorName }) => `ಡಾ. ${doctorName}\n\nಇಂದು ನಾವು ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?`,
  slotPickDate: () => 'ಯಾವ ದಿನ ಬರಲು ಇಷ್ಟಪಡುತ್ತೀರಿ?',
  slotPickPeriod: ({ date }) => `${date}\n\nದಿನದ ಯಾವ ಸಮಯ ನಿಮಗೆ ಅನುಕೂಲ?`,
  slotPickTime: ({ date }) => `${date} ದಿನ ಲಭ್ಯವಿರುವ ಸಮಯಗಳು — ಕೆಳಗೆ ಒಂದನ್ನು ಆಯ್ಕೆ ಮಾಡಿ.`,
  slotNoneAvailable: ({ date }) =>
    `ಕ್ಷಮಿಸಿ, ${date} ದಿನ ಯಾವ ಸಮಯವೂ ಖಾಲಿ ಇಲ್ಲ. ದಯವಿಟ್ಟು ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆ ಮಾಡಿ.`,
  slotNothingAvailable: () =>
    'ಕ್ಷಮಿಸಿ, ಸದ್ಯಕ್ಕೆ ಎಲ್ಲಾ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಳೂ ಬುಕ್ ಆಗಿವೆ. ದಯವಿಟ್ಟು ನಾಳೆ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  slotConfirmPrompt: ({ doctorName, date, time }) =>
    `ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಖಚಿತಪಡಿಸಬೇಕೆ?\n\nಡಾ. ${doctorName}\n*${date}, ${time} ಗೆ*`,
  slotBooked: ({ doctorName, clinicName, date, time }) =>
    `ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಖಚಿತವಾಗಿದೆ.\n\nಡಾ. ${doctorName} — ${clinicName}\n*${date}, ${time} ಗೆ*`,
  slotRemindBoth: () =>
    'ಹಿಂದಿನ ದಿನ ಸಂಜೆ ಮತ್ತು 1 ಗಂಟೆ ಮೊದಲು ನಿಮಗೆ ನೆನಪಿಸುತ್ತೇವೆ.',
  slotRemindHour: () => '1 ಗಂಟೆ ಮೊದಲು ನಿಮಗೆ ನೆನಪಿಸುತ್ತೇವೆ.',
  slotCancelNote: () => 'ಬರಲು ಆಗದಿದ್ದರೆ *ರದ್ದು* ಎಂದು ಕಳುಹಿಸಿ.',

  slotAlreadyBooked: ({ date, time }) =>
    `ನಿಮಗೆ ಈಗಾಗಲೇ *${date}, ${time} ಗೆ* ಬುಕ್ ಆಗಿದೆ.`,
  slotMoveConfirm: ({ doctorName, date, fromTime, toTime }) =>
    `ನಿಮಗೆ ಈಗಾಗಲೇ ಡಾ. ${doctorName} ಅವರ ಜೊತೆ *${date}, ${fromTime} ಗೆ* ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಇದೆ.

ಅದನ್ನು *${toTime}* ಕ್ಕೆ ಬದಲಿಸಬೇಕೆ?`,
  slotMoved: ({ doctorName, clinicName, date, time }) =>
    `ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬದಲಾಯಿತು.

ಡಾ. ${doctorName} — ${clinicName}
*${date}, ${time} ಗೆ*

ಬರಲು ಆಗದಿದ್ದರೆ *ರದ್ದು* ಎಂದು ಕಳುಹಿಸಿ.`,
  slotMoveKept: ({ date, time }) =>
    `ಬದಲಾವಣೆ ಇಲ್ಲ — ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಇನ್ನೂ *${date}, ${time} ಗೆ* ಇದೆ.`,
  slotTaken: () => 'ಕ್ಷಮಿಸಿ, ಆ ಸಮಯ ಈಗ ತಾನೇ ಬುಕ್ ಆಯಿತು. ದಯವಿಟ್ಟು ಬೇರೆ ಒಂದು ಆಯ್ಕೆ ಮಾಡಿ.',
  slotStatus: ({ doctorName, date, time }) =>
    `ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್:\nಡಾ. ${doctorName}\n*${date}, ${time} ಗೆ*`,
  slotCancelConfirm: ({ date, time }) =>
    `${date}, ${time} ಗೆ ಇರುವ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದು ಮಾಡಬೇಕೆ?`,
  slotCancelled: ({ date, time }) =>
    `${date}, ${time} ಗೆ ಇರುವ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ರದ್ದಾಗಿದೆ. ಮತ್ತೆ ಬುಕ್ ಮಾಡಲು ಯಾವಾಗಲಾದರೂ ಸಂದೇಶ ಕಳುಹಿಸಿ.`,
  slotReminderDayBefore: ({ doctorName, clinicName, date, time }) =>
    `ನೆನಪು: ನಾಳೆ, *${date}, ${time} ಗೆ* ${clinicName} ನಲ್ಲಿ ಡಾ. ${doctorName} ಅವರ ಜೊತೆ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಇದೆ. ಬರಲು ಆಗದಿದ್ದರೆ *ರದ್ದು* ಎಂದು ಕಳುಹಿಸಿ.`,
  slotReminderHourBefore: ({ doctorName, time }) =>
    `ನೆನಪು: ಡಾ. ${doctorName} ಅವರ ಜೊತೆ ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ *${time} ಗೆ* — ಸುಮಾರು 1 ಗಂಟೆ ನಂತರ. ದಯವಿಟ್ಟು ಕ್ಲಿನಿಕ್ ಕಡೆ ಹೊರಡಿ.`,
  slotDelayBroadcast: ({ doctorName, delayMins }) =>
    `ಸೂಚನೆ: ಡಾ. ${doctorName} ಇವತ್ತು ಸುಮಾರು ${delayMins} ನಿಮಿಷ ತಡವಾಗಿ ನಡೆಯುತ್ತಿದ್ದಾರೆ. ಅದಕ್ಕೆ ಅನುಸಾರವಾಗಿ ಬನ್ನಿ. ಅನಾನುಕೂಲಕ್ಕೆ ಕ್ಷಮಿಸಿ.`,
  slotInvalidChoice: () => 'ದಯವಿಟ್ಟು ಮೇಲೆ ಇರುವ ಆಯ್ಕೆಗಳಲ್ಲಿ ಒಂದನ್ನು ಆರಿಸಿ.',

  // ---- HYBRID mode ----
  btnEnglish: () => 'English',
  btnKannada: () => 'ಕನ್ನಡ',
  btnBookToken: () => 'ಟೋಕನ್ ಬುಕ್ ಮಾಡಿ',
  btnMyStatus: () => 'ಟೋಕನ್ ಸ್ಥಿತಿ',
  btnCancelToken: () => 'ಟೋಕನ್ ರದ್ದು ಮಾಡಿ',
  btnBookSlot: () => 'ಸಮಯ ಬುಕ್ ಮಾಡಿ',
  btnMyAppointment: () => 'ನನ್ನ ಸಮಯ',
  btnCancelSlot: () => 'ರದ್ದು ಮಾಡಿ',
  btnChangeDoctor: () => 'ವೈದ್ಯರನ್ನು ಬದಲಿಸಿ',
  btnChooseDate: () => 'ದಿನ ಆಯ್ಕೆಮಾಡಿ',
  btnChooseTime: () => 'ಸಮಯ ಆಯ್ಕೆಮಾಡಿ',
  btnMoreTimes: () => 'ಇನ್ನಷ್ಟು ಸಮಯ',
  btnMorning: () => 'ಬೆಳಿಗ್ಗೆ',
  btnAfternoon: () => 'ಮಧ್ಯಾಹ್ನ',
  btnEvening: () => 'ಸಂಜೆ',
  btnYes: () => 'ಹೌದು, ಖಚಿತ',
  btnNo: () => 'ಇಲ್ಲ, ಹಿಂದೆ',
  btnYesCancel: () => 'ಹೌದು, ರದ್ದು ಮಾಡಿ',
  btnKeepIt: () => 'ಇಲ್ಲ, ಹಾಗೇ ಇರಲಿ',

  hybridModeChoice: ({ doctorName }) =>
    `ಡಾ. ${doctorName} ಅವರನ್ನು ಹೇಗೆ ನೋಡಲು ಇಷ್ಟ?`,
};

export const templates: Record<Language, TemplateSet> = { EN: en, KN: kn };

/**
 * Render a patient-facing string.
 *
 *   t('KN', 'tokenBooked', { tokenNumber: 12, ... })
 *
 * Falls back to English if a language is somehow unregistered, so a bad enum
 * value degrades to a readable message instead of throwing mid-conversation.
 */
export function t<K extends keyof TemplateSet>(
  language: Language,
  key: K,
  ...params: Parameters<TemplateSet[K]>
): string {
  const set = templates[language] ?? templates.EN;
  const fn = set[key] as (...a: Parameters<TemplateSet[K]>) => string;
  return fn(...params);
}

export type TemplateName = keyof TemplateSet;
