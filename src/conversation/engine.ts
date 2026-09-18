import type { BookingMode, Clinic, Doctor, Language, Patient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { outboundChannelForClinic, resolveClinicForChannel } from '../domain/clinics';
import { findOrCreatePatient } from '../domain/patients';
import { t } from '../i18n/templates';
import type { InboundMessage } from '../messaging/types';
import { cancelReminders, enqueueOutboundBulk, enqueueTokenQueueRecalc } from '../queue/queues';
import { logger } from '../utils/logger';
import { clinicToday } from '../utils/time';
import { hybridFlow } from './flows/hybrid';
import { runOnboarding } from './flows/onboarding';
import { askWhichDoctor, readDoctorChoice } from './flows/selectDoctor';
import { slotFlow } from './flows/slot';
import { tokenFlow } from './flows/token';
import { loadSession, saveSession } from './session';
import { Steps } from './steps';
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

  const resolved = await resolveClinicForChannel(inbound.channelAddress);
  if (!resolved) {
    logger.warn(
      { channelAddress: inbound.channelAddress },
      'Inbound message could not be mapped to a clinic; set DEFAULT_DOCTOR_ID or Clinic.whatsappPhoneNumberId',
    );
    return { handled: false, replies: [], reason: 'NO_DOCTOR' };
  }
  const { clinic, doctors } = resolved;

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
    const replies = await runTurn(clinic, doctors, patient, inbound);
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
    patient,
    step: session.step,
    data: session.data,
    language,
    input: inbound.text,
    receivedAt: inbound.receivedAt,
    today,
  };

  const onboarding = await runOnboarding(baseCtx);

  let result: StepResult;
  const prefix: Reply[] = [];

  if (!onboarding.complete) {
    result = onboarding.result;
  } else {
    if (onboarding.patch.language) language = onboarding.patch.language;
    if (onboarding.patch.name || onboarding.patch.language) {
      patient = { ...patient, ...onboarding.patch } as Patient;
    }
    prefix.push(...onboarding.prefixReplies);

    // Which doctor, before any flow runs — a flow's every branch assumes one.
    const selection = selectDoctor({
      doctors,
      chosen: doctor,
      step: session.step,
      data: session.data,
      input: onboarding.enterFlowFresh ? '' : inbound.text,
      language,
    });

    if (selection.pending) {
      result = selection.result;
    } else {
      doctor = selection.doctor;
      const flow = flowFor(doctor.bookingMode);

      // Park the patient on a step this flow understands. A doctor switching
      // booking_mode mid-session lands here too, as does a patient arriving
      // from the doctor picker.
      const ownedStep = flow.owns(session.step) ? session.step : flow.entryStep;
      const fresh =
        onboarding.enterFlowFresh || selection.justChosen || ownedStep !== session.step;

      result = await flow.handle({
        ...baseCtx,
        doctor,
        patient,
        language,
        step: ownedStep,
        input: fresh ? '' : inbound.text,
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
  if (input.chosen) return { pending: false, doctor: input.chosen, justChosen: false };
  if (input.doctors.length === 1) {
    return { pending: false, doctor: input.doctors[0]!, justChosen: true };
  }

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
