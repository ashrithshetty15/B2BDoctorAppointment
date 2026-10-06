import type { BookingMode, Clinic, Doctor, Language, Patient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { outboundChannelForClinic, resolveClinicForChannel, sharedNumberPrompt } from '../domain/clinics';
import { doctorForFollowUpTap, markFollowUpTapped, parseFollowUpPayload } from '../domain/followUp';
import { findOrCreatePatient } from '../domain/patients';
import { t } from '../i18n/templates';
import { MAX_LIST_ROWS, type InboundMessage } from '../messaging/types';
import { cancelReminders, enqueueOutboundBulk, enqueueTokenQueueRecalc } from '../queue/queues';
import { logger } from '../utils/logger';
import { clinicToday } from '../utils/time';
import { hybridFlow } from './flows/hybrid';
import { runOnboarding } from './flows/onboarding';
import { isDoctorSwitchRequest } from './intent';
import { askWhichDoctor, readDoctorChoice } from './flows/selectDoctor';
import { slotFlow } from './flows/slot';
import { tokenFlow } from './flows/token';
import { loadSession, saveSession } from './session';
import { Steps } from './steps';
import { reply, replyWithList } from './types';
import type { ConversationContext, ConversationFlow, Effect, Reply, StepResult } from './types';

/**
 * Conversation engine: the only place that stitches together session storage,
 * onboarding, the mode-specific flow and outbound delivery.
 *
 * It never touches a provider SDK — replies leave via the outbound BullMQ queue,
 * which is the single point where the messaging adapter is used.
 */

export function flowFor(mode: BookingMode): ConversationFlow {
  switch (mode) {
    case 'SLOT':
      return slotFlow;
    case 'HYBRID':
      return hybridFlow;
    case 'TOKEN':
    default:
      return tokenFlow;
  }
}

export interface HandleResult {
  handled: boolean
  replies: Reply[];
  reason?: 'DUPLICATE' | 'NO_DOCTOR' | 'ERROR';
}

export async function handleInboundMessage(inbound: InboundMessage): Promise<HandleResult> {
  if (await alreadyProcessed(inbound.providerMessageId)) {
    logger.debug({ id: inbound.providerMessageId }, 'Duplicate inbound message ignored');
    return { handled: false, replies: [], reason: 'DUPLICATE' };
  }

  const resolved = await resolveClinicForChannel(inbound.channelAddress, {
    text: inbound.text,
    phone: inbound.from,
  });
  if (!resolved) {
    /**
     * On the shared platform number, answer anyway.
     *
     * Elsewhere silence is right: an unknown number gives us no clinic to speak
     * as, and guessing one would hand a patient to the wrong practice. The
     * platform number is the exception — we are the sender there, so we can say
     * we need their clinic's link without pretending to be any clinic. This is
     * also the number on every printed QR code, so a patient arriving without a
     * code is ordinary traffic, and leaving them staring at a sent tick is the
     * one outcome worse than asking.
     */
    const prompt = await sharedNumberPrompt(inbound.channelAddress, inbound.from);
    if (prompt) {
      /**
       * Offered as a tappable list, not as instructions.
       *
       * Telling a patient who is already in this chat to open their clinic's
       * link or scan its QR code is advice they cannot act on: the link is the
       * thing they do not have, which is exactly why they are here. Each row's
       * id is the clinic's code, so tapping one sends precisely what the
       * deeplink would have sent, and it resolves through the ordinary code
       * path -- no extra step, no extra state, and the same route a scanned QR
       * takes.
       */
      /**
       * Truncated here rather than left to the adapter.
       *
       * WhatsApp allows ten list rows and the adapter slices silently, so an
       * eleventh clinic would simply not appear -- and because the rows replaced
       * the old "use your clinic's link" paragraph, the patient would be left
       * with no way to reach it and nothing explaining why. Clinics arrive
       * most-recent-first, so the ten kept are the ten they are likeliest to
       * mean, and the copy changes to say the list is not everything.
       */
      const shown = prompt.clinics.slice(0, MAX_LIST_ROWS);
      const truncated = prompt.clinics.length > shown.length;

      const reply: Reply =
        prompt.clinics.length > 1
          ? replyWithList(
              'chooseClinic',
              t(prompt.language, truncated ? 'chooseClinicMore' : 'chooseClinic'),
              t(prompt.language, 'btnChooseClinic'),
              shown.map((c) => ({ id: c.code, title: c.name })),
            )
          : {
              templateName: 'clinicLinkNeeded',
              text: t(prompt.language, 'clinicLinkNeeded'),
            };

      await enqueueOutboundBulk([
        {
          to: inbound.from,
          text: reply.text,
          templateName: reply.templateName,
          channelAddress: inbound.channelAddress,
          ...(reply.list?.rows.length ? { list: reply.list } : {}),
        },
      ]);
      // Marked processed: the patient got an answer, so a Meta retry would only
      // send it twice.
      await markProcessed(inbound.providerMessageId);
      return { handled: true, replies: [reply] };
    }

    logger.warn(
      { channelAddress: inbound.channelAddress },
      'Inbound message could not be mapped to a clinic; set DEFAULT_DOCTOR_ID or Clinic.whatsappPhoneNumberId',
    );
    return { handled: false, replies: [], reason: 'NO_DOCTOR' };
  }
  const { clinic, doctors, boundByCode } = resolved;

  const patient = await findOrCreatePatient(inbound.from, { language: clinic.defaultLanguage });

  // Opens the 24-hour window in which we may send this patient a free-form
  // message. Stamped before the turn runs, not after: a turn that throws still
  // means the patient messaged us, and the window opened regardless.
  //
  // Stamped for every doctor at the clinic, because the window belongs to the
  // business *number* and the number is the clinic's. A patient who writes in
  // and then picks Dr. B has opened the window for Dr. B just as much as for
  // Dr. A. (The row is still keyed per doctor; folding it onto the clinic is a
  // later migration.) It must never be credited to a clinic they never wrote to.
  await Promise.all(doctors.map((d) => markInboundSeen(patient.id, d.id)));

  try {
    const replies = await runTurn(clinic, doctors, patient, inbound, boundByCode);
    await markProcessed(inbound.providerMessageId);
    return { handled: true, replies };
  } catch (err) {
    logger.error(
      { err, phone: inbound.from, clinicId: clinic.id },
      'Conversation turn failed; sending generic error to patient',
    );

    const language = patient.language;
    const errorReply: Reply = {
      templateName: 'errorGeneric',
      text: t(language, 'errorGeneric'),
    };
    await dispatchReplies(clinic, patient, [errorReply]);

    // Deliberately not marked processed: a Meta retry gets another chance.
    return { handled: false, replies: [errorReply], reason: 'ERROR' };
  }
}

async function runTurn(
  clinic: Clinic,
  doctors: Doctor[],
  patientRow: Patient,
  inbound: InboundMessage,
  boundByCode = false,
): Promise<Reply[]> {
  const session = await loadSession(inbound.from, clinic.id, patientRow.language);
  const today = clinicToday(clinic.timezone);

  let patient = patientRow;
  let language: Language = session.language;

  // The doctor chosen earlier in this conversation, if they are still bookable.
  // A placeholder stands in until one is picked: onboarding reads only the
  // clinic, and no flow runs before selection completes.
  let doctor = doctors.find((d) => d.id === session.doctorId) ?? null;

  const baseCtx: ConversationContext = {
    clinic,
    doctor: doctor ?? doctors[0]!,
    doctorCount: doctors.length,
    patient,
    step: session.step,
    data: session.data,
    language,
    input: inbound.text,
    receivedAt: inbound.receivedAt,
    today,
  };

  const onboarding = await runOnboarding(baseCtx);

  /**
   * A tap on a follow-up reminder's button, which is not ordinary input.
   *
   * It names the doctor who asked them back, so it settles the choice instead
   * of asking — the tap has to *be* the whole interaction, or the reminder is
   * not one tap and the patient can be booked with the wrong doctor at a
   * practice with several. It then enters the flow already asking to book,
   * which both TOKEN and SLOT understand.
   */
  const followUpTap = await readFollowUpTap(
    inbound.text,
    patient.id,
    doctors,
    inbound.receivedAt,
  );

  let result: StepResult;
  const prefix: Reply[] = [];

  if (!onboarding.complete) {
    result = onboarding.result;
  } else {
    if (onboarding.patch.language) language = onboarding.patch.language;
    if (onboarding.patch.name || onboarding.patch.language) {
      patient = { ...patient, ...onboarding.patch } as Patient;
    }
    /**
     * Say which clinic, when a deeplink code just chose one and nothing else
     * will say it.
     *
     * Onboarding names the clinic itself when it speaks — askName and
     * welcomeBack both carry it — so this fires only when onboarding stayed
     * silent, which is the case of an already-known patient resuming. On a
     * clinic's own number that silence is fine, because the chat header is the
     * clinic. On the shared number it leaves the patient in a thread named
     * after the platform with no idea whose appointment book they are in.
     */
    if (boundByCode && onboarding.prefixReplies.length === 0) {
      prefix.push(reply('clinicIntro', t(language, 'clinicIntro', { clinicName: clinic.name })));
    }

    prefix.push(...onboarding.prefixReplies);

    // Which doctor, before any flow runs — a flow's every branch assumes one.
    const selection = selectDoctor({
      doctors,
      chosen: followUpTap?.doctor ?? doctor,
      step: followUpTap ? Steps.ENTRY : session.step,
      data: session.data,
      input: onboarding.enterFlowFresh || followUpTap ? '' : inbound.text,
      language,
    });

    if (selection.pending) {
      // Forget whoever was chosen before, so the answer to this question is
      // read as a fresh choice. Left set, the next turn would honour the old
      // doctor again and the switch could never complete.
      doctor = null;
      result = selection.result;
    } else {
      doctor = selection.doctor;
      const flow = flowFor(doctor.bookingMode);

      // Park the patient on a step this flow understands. A doctor switching
      // booking_mode mid-session lands here too, as does a patient arriving
      // from the doctor picker.
      // A follow-up tap starts its own conversation: whatever the patient was
      // last parked on is weeks stale and has nothing to do with the reminder
      // they just answered.
      const ownedStep = followUpTap
        ? flow.entryStep
        : flow.owns(session.step)
          ? session.step
          : flow.entryStep;
      const fresh =
        onboarding.enterFlowFresh || selection.justChosen || ownedStep !== session.step;

      result = await flow.handle({
        ...baseCtx,
        doctor,
        patient,
        language,
        step: ownedStep,
        // BOOK is what the tap means. Sent as the intent word rather than a
        // menu number so it survives the menus being renumbered or reordered.
        input: followUpTap ? 'book' : fresh ? '' : inbound.text,
      });
    }
  }

  if (result.language) language = result.language;

  await saveSession({
    phone: inbound.from,
    clinicId: clinic.id,
    doctorId: doctor?.id ?? null,
    step: result.nextStep,
    data: result.data ?? session.data,
    language,
    patientId: patient.id,
  });

  const replies = [...prefix, ...result.replies];
  await dispatchReplies(clinic, patient, replies);
  await runEffects(result.effects ?? []);

  return replies;
}

/**
 * Recognise a tap on a follow-up reminder, and say who it is with.
 *
 * Returns null for everything else, including a payload that does not resolve
 * — a stale appointment, a doctor who has since left, or an id a patient made
 * up. In every one of those cases the message falls through and is handled as
 * ordinary text, which is the same thing the patient would have got had they
 * typed "book" themselves.
 */
async function readFollowUpTap(
  text: string,
  patientId: string,
  doctors: Doctor[],
  at: Date,
): Promise<{ doctor: Doctor } | null> {
  const appointmentId = parseFollowUpPayload(text);
  if (!appointmentId) return null;

  const doctorId = await doctorForFollowUpTap(appointmentId, patientId, doctors);
  if (!doctorId) {
    logger.info({ appointmentId }, 'Follow-up tap did not resolve; treating as ordinary input');
    return null;
  }

  const doctor = doctors.find((d) => d.id === doctorId);
  if (!doctor) return null;

  // Recorded here rather than after the booking, because the tap is the thing
  // that happened: a patient who taps and then changes their mind still
  // answered the reminder, and a funnel that only counted completed bookings
  // could never show the clinic where it was losing them.
  await markFollowUpTapped(appointmentId, at);

  return { doctor };
}

type Selection =
  | { pending: true; result: StepResult }
  | { pending: false; doctor: Doctor; justChosen: boolean };

/**
 * Settle which doctor this turn is for.
 *
 * A solo clinic never reaches the question: one doctor means one answer, and
 * asking it would be a step for nothing. Once chosen, the doctor is carried in
 * the session for the rest of the conversation.
 */
function selectDoctor(input: {
  doctors: Doctor[];
  chosen: Doctor | null;
  step: string;
  data: Record<string, unknown>;
  input: string;
  language: Language;
}): Selection {
  // One doctor, one answer — the question would be a step for nothing, and
  // there is nothing to switch to either.
  if (input.doctors.length === 1) {
    const only = input.doctors[0]!;
    // "Just chosen" has to mean the doctor *changed* this turn, not merely that
    // one was settled on. Reporting it every turn made the engine treat every
    // message as a fresh arrival, blank the input and re-render the menu — a
    // one-doctor clinic could tap "Book a token" forever and only get the menu
    // back.
    return { pending: false, doctor: only, justChosen: input.chosen?.id !== only.id };
  }

  // "doctor", "ಬೇರೆ ವೈದ್ಯ" — re-open the choice. Checked before the chosen
  // doctor is honoured, because otherwise the choice is made once and kept for
  // the whole session: picking the wrong doctor left no way back short of
  // waiting two hours for the session to expire.
  if (isDoctorSwitchRequest(input.input)) {
    return { pending: true, result: askWhichDoctor(input.doctors, input.language) };
  }

  if (input.chosen) return { pending: false, doctor: input.chosen, justChosen: false };

  if (input.step === Steps.SELECT_DOCTOR && input.input.trim() !== '') {
    const offered = (input.data['doctorIds'] as string[] | undefined) ?? [];
    const choice = readDoctorChoice(input.input, offered, input.doctors, input.language);
    return choice.chosen
      ? { pending: false, doctor: choice.chosen, justChosen: true }
      : { pending: true, result: choice.result };
  }

  return { pending: true, result: askWhichDoctor(input.doctors, input.language) };
}

/** Hands replies to the outbound queue — never sends inline. */
async function dispatchReplies(clinic: Clinic, patient: Patient, replies: Reply[]): Promise<void> {
  if (!replies.length) return;

  const channelAddress = outboundChannelForClinic(clinic);

  await enqueueOutboundBulk(
    replies.map((r) => ({
      to: patient.phone,
      text: r.text,
      templateName: r.templateName,
      ...(r.buttons?.length ? { buttons: r.buttons } : {}),
      ...(r.list?.rows.length ? { list: r.list } : {}),
      ...(channelAddress ? { channelAddress } : {}),
    })),
  );
}

async function runEffects(effects: Effect[]): Promise<void> {
  for (const effect of effects) {
    switch (effect.type) {
      case 'RECALC_TOKEN_QUEUE':
        await enqueueTokenQueueRecalc({
          doctorId: effect.doctorId,
          date: effect.date,
          trigger: 'BOOKING_CREATED',
          ...(effect.originAppointmentId
            ? { originAppointmentId: effect.originAppointmentId }
            : {}),
        });
        break;
      case 'CANCEL_REMINDERS':
        await cancelReminders(effect.appointmentId);
        break;
      case 'SCHEDULE_REMINDERS':
        // Wired up with the SLOT flow — see queue/jobs/reminders.ts.
        break;
      default:
        break;
    }
  }
}

/**
 * Bookkeeping only — a failure here must never cost the patient their reply, so
 * it is logged and swallowed. The cost of losing one stamp is that a cancellation
 * puts this patient on the call list unnecessarily, which is the safe direction.
 */
async function markInboundSeen(patientId: string, doctorId: string): Promise<void> {
  const lastInboundAt = new Date();
  try {
    await prisma.messagingWindow.upsert({
      where: { patient_doctor: { patientId, doctorId } },
      create: { patientId, doctorId, lastInboundAt },
      update: { lastInboundAt },
    });
  } catch (err) {
    logger.warn({ err, patientId, doctorId }, 'Could not stamp the messaging window');
  }
}

async function alreadyProcessed(providerMessageId: string): Promise<boolean> {
  const found = await prisma.processedMessage.findUnique({ where: { providerMessageId } });
  return found !== null;
}

async function markProcessed(providerMessageId: string): Promise<void> {
  try {
    await prisma.processedMessage.create({ data: { providerMessageId } });
  } catch (err) {
    // Unique violation = a concurrent delivery of the same message won the race.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
  }
}

export { Steps };
