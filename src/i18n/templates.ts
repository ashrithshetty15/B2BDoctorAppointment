import type { Language } from '@prisma/client';

/**
 * Every patient-facing string lives here, keyed by {language}.{templateName}.
 * Business logic never concatenates copy — it calls `t(lang, 'name', params)`.
 *
 * Adding a language = add one object below. Adding a template = add it to
 * `TemplateSet`; TypeScript then forces every language to implement it, so a
 * language can never silently fall out of sync.
 *
 * Kannada (KN) is served as Kanglish — Kannada rendered in Latin script —
 * because that is how most patients type on WhatsApp. Swap the KN object for
 * native-script strings without touching any other file.
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
  slotPickDate: (p: { options: string }) => string;
  slotPickTime: (p: { date: string; options: string }) => string;
  slotNoneAvailable: (p: { date: string }) => string;
  slotConfirmPrompt: (p: { doctorName: string; date: string; time: string }) => string;
  slotBooked: (p: { doctorName: string; clinicName: string; date: string; time: string }) => string;
  slotAlreadyBooked: (p: { date: string; time: string }) => string;
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
  hybridModeChoice: (p: { doctorName: string }) => string;
};

const en: TemplateSet = {
  languagePrompt: () =>
    'Welcome! Please choose your language:\n\n1. English\n2. ಕನ್ನಡ (Kannada)\n\nReply with 1 or 2.',
  languageInvalid: () => 'Please reply with 1 for English or 2 for Kannada.',
  askName: ({ clinicName }) =>
    `Welcome to ${clinicName}. What is your name? (Please type your full name)`,
  nameInvalid: () => 'Please type your name using at least 2 letters.',
  welcomeBack: ({ patientName, clinicName }) => `Welcome back, ${patientName}! — ${clinicName}`,
  sessionExpired: () => 'Your session timed out, so we are starting again.',
  errorGeneric: () =>
    'Sorry, something went wrong on our side. Please try again in a moment, or call the clinic.',
  unknownInput: () => 'Sorry, I did not understand that. Please reply with one of the numbers shown above.',
  doctorOnLeave: ({ doctorName, date }) =>
    `Dr. ${doctorName} is not available on ${date}. Please try another day.`,
  notConfigured: () =>
    'This clinic is not set up for WhatsApp booking yet. Please call the clinic directly.',
  nowServingNone: () => 'not started yet',

  // ---- TOKEN mode ----
  tokenMainMenu: ({ doctorName, date }) =>
    `Dr. ${doctorName} — ${date}\n\n1. Book a token for today\n2. Check my token status\n3. Cancel my token\n\nReply with 1, 2 or 3.`,
  tokenConfirmPrompt: ({ doctorName, date }) =>
    `Book a token with Dr. ${doctorName} for ${date}?\n\n1. Yes, confirm\n2. No, go back`,
  tokenBooked: ({ tokenNumber, date, doctorName, nowServing, ahead, eta }) =>
    `Your token is confirmed.\n\n*Token #${tokenNumber}*\nDr. ${doctorName} — ${date}\nNow serving: ${nowServing}\nPatients ahead of you: ${ahead}\nApprox. wait: ${eta}\n\nWe will message you as the queue moves. Reply 2 anytime to check your status.`,
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
    `Cancel *token #${tokenNumber}* for ${date}?\n\n1. Yes, cancel it\n2. No, keep it`,
  tokenCancelled: ({ tokenNumber }) =>
    `Token #${tokenNumber} has been cancelled. Message us anytime to book again.`,
  tokenCancelAborted: () => 'Your token has been kept. Nothing was cancelled.',
  tokenNoActiveBooking: () =>
    'You do not have an active token for today. Reply 1 to book one.',
  tokenDelayBroadcast: ({ doctorName, delayMins, eta }) =>
    `Update: Dr. ${doctorName} is running about ${delayMins} mins late today. Sorry for the inconvenience.\nYour new approx. wait: ${eta}`,
  tokenVisitDone: ({ doctorName }) =>
    `Thank you for visiting Dr. ${doctorName}. Wishing you a speedy recovery. Message us anytime to book again.`,
  tokenNoShow: ({ tokenNumber }) =>
    `Token #${tokenNumber} was called but you were not present, so it has been marked as missed. Reply 1 to book a fresh token.`,
  tokenBookingCancelledByClinic: ({ tokenNumber, date }) =>
    `Sorry — your *token #${tokenNumber}* for ${date} has been cancelled as the doctor is unavailable. Please book again for another day.`,

  // ---- SLOT mode ----
  slotMainMenu: ({ doctorName }) =>
    `Dr. ${doctorName}\n\n1. Book an appointment\n2. Check my appointment\n3. Cancel my appointment\n\nReply with 1, 2 or 3.`,
  slotPickDate: ({ options }) => `Please choose a date:\n\n${options}\n\nReply with the number.`,
  slotPickTime: ({ date, options }) =>
    `Available times on ${date}:\n\n${options}\n\nReply with the number of your preferred time.`,
  slotNoneAvailable: ({ date }) =>
    `Sorry, no appointment times are free on ${date}. Please choose another date.`,
  slotConfirmPrompt: ({ doctorName, date, time }) =>
    `Confirm your appointment?\n\nDr. ${doctorName}\n${date} at ${time}\n\n1. Yes, confirm\n2. No, go back`,
  slotBooked: ({ doctorName, clinicName, date, time }) =>
    `Your appointment is confirmed.\n\nDr. ${doctorName} — ${clinicName}\n*${date} at ${time}*\n\nWe will remind you the evening before and again 1 hour ahead. Reply 3 to cancel.`,
  slotAlreadyBooked: ({ date, time }) =>
    `You already have an appointment on *${date} at ${time}*. Reply 3 to cancel it first.`,
  slotTaken: () => 'Sorry, that time was just taken. Please pick another one.',
  slotStatus: ({ doctorName, date, time }) =>
    `Your appointment:\nDr. ${doctorName}\n*${date} at ${time}*`,
  slotCancelConfirm: ({ date, time }) =>
    `Cancel your appointment on ${date} at ${time}?\n\n1. Yes, cancel it\n2. No, keep it`,
  slotCancelled: ({ date, time }) =>
    `Your appointment on ${date} at ${time} has been cancelled. Message us anytime to book again.`,
  slotReminderDayBefore: ({ doctorName, clinicName, date, time }) =>
    `Reminder: you have an appointment with Dr. ${doctorName} at ${clinicName} tomorrow, *${date} at ${time}*. Reply 3 if you need to cancel.`,
  slotReminderHourBefore: ({ doctorName, time }) =>
    `Reminder: your appointment with Dr. ${doctorName} is at *${time}* — about 1 hour from now. Please start for the clinic.`,
  slotDelayBroadcast: ({ doctorName, delayMins }) =>
    `Update: Dr. ${doctorName} is running about ${delayMins} mins late today. Please plan your arrival accordingly. Sorry for the inconvenience.`,
  slotInvalidChoice: () => 'Please reply with one of the numbers from the list above.',

  // ---- HYBRID mode ----
  hybridModeChoice: ({ doctorName }) =>
    `How would you like to see Dr. ${doctorName}?\n\n1. Book a fixed appointment time\n2. Take a token and come today\n\nReply with 1 or 2.`,
};

const kn: TemplateSet = {
  languagePrompt: () =>
    'Swagatha! Nimma bhashe aayke maadi:\n\n1. English\n2. ಕನ್ನಡ (Kannada)\n\n1 athava 2 ottisi.',
  languageInvalid: () => 'Dayavittu English ge 1, Kannada ge 2 ottisi.',
  askName: ({ clinicName }) => `${clinicName} ge swagatha. Nimma hesaru enu? (Poorna hesaru type maadi)`,
  nameInvalid: () => 'Dayavittu nimma hesarannu kaddapaksha 2 aksharagalalli type maadi.',
  welcomeBack: ({ patientName, clinicName }) =>
    `Matte swagatha, ${patientName}! — ${clinicName}`,
  sessionExpired: () => 'Nimma session time out aagide, adhrinda modhalinda shuru maadutteve.',
  errorGeneric: () =>
    'Kshamisi, namma kadeyinda enadru thappagide. Swalpa hothina nantara punaha prayathnisi, athava clinic ge phone maadi.',
  unknownInput: () =>
    'Kshamisi, nanage arthavaagalilla. Dayavittu mele thorisiruva sankhyegalalli ondannu ottisi.',
  doctorOnLeave: ({ doctorName, date }) =>
    `Dr. ${doctorName} ${date} dina labhyavilla. Dayavittu bere dina prayathnisi.`,
  notConfigured: () =>
    'Ee clinic innu WhatsApp booking ge siddhavaagilla. Dayavittu clinic ge neravaagi phone maadi.',
  nowServingNone: () => 'innu shuru aagilla',

  // ---- TOKEN mode ----
  tokenMainMenu: ({ doctorName, date }) =>
    `Dr. ${doctorName} — ${date}\n\n1. Ivattu token book maadi\n2. Nanna token status nodi\n3. Nanna token cancel maadi\n\n1, 2 athava 3 ottisi.`,
  tokenConfirmPrompt: ({ doctorName, date }) =>
    `Dr. ${doctorName} avara jothe ${date} ge token book maadabeka?\n\n1. Haudu, confirm maadi\n2. Illa, hindhe hogi`,
  tokenBooked: ({ tokenNumber, date, doctorName, nowServing, ahead, eta }) =>
    `Nimma token confirm aagide.\n\n*Token #${tokenNumber}*\nDr. ${doctorName} — ${date}\nIga nadeyuttiruva token: ${nowServing}\nNimma munde iruva rogigalu: ${ahead}\nAndaaju kaayuva samaya: ${eta}\n\nQueue munde hodaage nimage message maadutteve. Status nodalu yaavaglaadaru 2 ottisi.`,
  tokenAlreadyBooked: ({ tokenNumber, ahead, eta }) =>
    `Nimage ivattige aagale *token #${tokenNumber}* ide.\nNimma munde iruva rogigalu: ${ahead}\nAndaaju kaayuva samaya: ${eta}`,
  tokenQueueFull: ({ doctorName }) =>
    `Kshamisi, Dr. ${doctorName} avara ivattina ella tokengalu bharthi aagive. Dayavittu naale belagge message maadi.`,
  tokenListClosed: () => 'Ivattige token booking muchchalaagide. Dayavittu naale prayathnisi.',
  tokenStatus: ({ tokenNumber, nowServing, ahead, eta }) =>
    `*Token #${tokenNumber}*\nIga nadeyuttiruva token: ${nowServing}\nNimma munde iruva rogigalu: ${ahead}\nAndaaju kaayuva samaya: ${eta}`,
  tokenPositionUpdate: ({ tokenNumber, nowServing, ahead, eta }) =>
    `Queue update — *token #${tokenNumber}*\nIga nadeyuttiruva token: ${nowServing}\nNimma munde iruva rogigalu: ${ahead}\nAndaaju kaayuva samaya: ${eta}`,
  tokenUpNext: ({ tokenNumber }) =>
    `Mundina sara nimmadu! *Token #${tokenNumber}* — dayavittu clinic ge bandu doctor room hora kaayiri.`,
  tokenYourTurn: ({ tokenNumber, doctorName }) =>
    `Iga nimma sara. *Token #${tokenNumber}* — dayavittu Dr. ${doctorName} avarannu nodalu olage hogi.`,
  tokenCancelConfirm: ({ tokenNumber, date }) =>
    `${date} ge iruva *token #${tokenNumber}* cancel maadabeka?\n\n1. Haudu, cancel maadi\n2. Illa, hage iralli`,
  tokenCancelled: ({ tokenNumber }) =>
    `Token #${tokenNumber} cancel aagide. Matte book maadalu yaavaglaadaru message maadi.`,
  tokenCancelAborted: () => 'Nimma token hage ide. Enu cancel aagilla.',
  tokenNoActiveBooking: () =>
    'Ivattige nimage yaava token-oo illa. Ondu book maadalu 1 ottisi.',
  tokenDelayBroadcast: ({ doctorName, delayMins, eta }) =>
    `Suchane: Dr. ${doctorName} ivattu sumaaru ${delayMins} nimisha tadavaagi nadeyuttiddare. Asoukaryakke kshamisi.\nNimma hosa andaaju kaayuva samaya: ${eta}`,
  tokenVisitDone: ({ doctorName }) =>
    `Dr. ${doctorName} avarannu bheti maadiddakke dhanyavaada. Beega gunavaagali. Matte book maadalu yaavaglaadaru message maadi.`,
  tokenNoShow: ({ tokenNumber }) =>
    `Token #${tokenNumber} karesalaayithu aadare neevu illade iddaddarinda adannu miss endu guruthisalaagide. Hosa token book maadalu 1 ottisi.`,
  tokenBookingCancelledByClinic: ({ tokenNumber, date }) =>
    `Kshamisi — doctor labhyavillade iruvudarinda ${date} ge iruva nimma *token #${tokenNumber}* cancel maadalaagide. Dayavittu bere dinakke matte book maadi.`,

  // ---- SLOT mode ----
  slotMainMenu: ({ doctorName }) =>
    `Dr. ${doctorName}\n\n1. Appointment book maadi\n2. Nanna appointment nodi\n3. Nanna appointment cancel maadi\n\n1, 2 athava 3 ottisi.`,
  slotPickDate: ({ options }) => `Dayavittu dinaanka aayke maadi:\n\n${options}\n\nSankhye ottisi.`,
  slotPickTime: ({ date, options }) =>
    `${date} dina labhya iruva samayagalu:\n\n${options}\n\nNimage beku aada samayada sankhye ottisi.`,
  slotNoneAvailable: ({ date }) =>
    `Kshamisi, ${date} dina yaava samayavu khaali illa. Dayavittu bere dinaanka aayke maadi.`,
  slotConfirmPrompt: ({ doctorName, date, time }) =>
    `Nimma appointment confirm maadabeka?\n\nDr. ${doctorName}\n${date}, ${time} ge\n\n1. Haudu, confirm maadi\n2. Illa, hindhe hogi`,
  slotBooked: ({ doctorName, clinicName, date, time }) =>
    `Nimma appointment confirm aagide.\n\nDr. ${doctorName} — ${clinicName}\n*${date}, ${time} ge*\n\nHindina dina sanje mattu 1 gante modhalu nimage nenapisutteve. Cancel maadalu 3 ottisi.`,
  slotAlreadyBooked: ({ date, time }) =>
    `Nimage aagale *${date}, ${time} ge* appointment ide. Modalu adannu cancel maadalu 3 ottisi.`,
  slotTaken: () => 'Kshamisi, aa samaya iga thaane booking aayithu. Dayavittu bere ondu aayke maadi.',
  slotStatus: ({ doctorName, date, time }) =>
    `Nimma appointment:\nDr. ${doctorName}\n*${date}, ${time} ge*`,
  slotCancelConfirm: ({ date, time }) =>
    `${date}, ${time} ge iruva nimma appointment cancel maadabeka?\n\n1. Haudu, cancel maadi\n2. Illa, hage iralli`,
  slotCancelled: ({ date, time }) =>
    `${date}, ${time} ge iruva nimma appointment cancel aagide. Matte book maadalu yaavaglaadaru message maadi.`,
  slotReminderDayBefore: ({ doctorName, clinicName, date, time }) =>
    `Nenapu: naale, *${date}, ${time} ge* ${clinicName} nalli Dr. ${doctorName} avara jothe nimma appointment ide. Cancel maadabekaadare 3 ottisi.`,
  slotReminderHourBefore: ({ doctorName, time }) =>
    `Nenapu: Dr. ${doctorName} avara jothe nimma appointment *${time} ge* — sumaaru 1 gante nantara. Dayavittu clinic kade horadi.`,
  slotDelayBroadcast: ({ doctorName, delayMins }) =>
    `Suchane: Dr. ${doctorName} ivattu sumaaru ${delayMins} nimisha tadavaagi nadeyuttiddare. Adakke anusaara bandu seri. Asoukaryakke kshamisi.`,
  slotInvalidChoice: () => 'Dayavittu mele iruva pattiyinda ondu sankhye ottisi.',

  // ---- HYBRID mode ----
  hybridModeChoice: ({ doctorName }) =>
    `Dr. ${doctorName} avarannu hege nodalu ista?\n\n1. Nirdhishta appointment samaya book maadi\n2. Token thegondu ivattu banni\n\n1 athava 2 ottisi.`,
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
