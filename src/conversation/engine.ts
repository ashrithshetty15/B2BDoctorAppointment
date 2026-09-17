import type { BookingMode, Doctor, Language, Patient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { outboundChannelFor, resolveDoctorForChannel } from '../domain/doctors';
import { findOrCreatePatient } from '../domain/patients';
import { t } from '../i18n/templates';
import type { InboundMessage } from '../messaging/types';
import { cancelReminders, enqueueOutboundBulk, enqueueTokenQueueRecalc } from '../queue/queues';
import { logger } from '../utils/logger';
import { clinicToday } from '../utils/time';
import { hybridFlow } from './flows/hybrid';
import { runOnboarding } from './flows/onboarding';
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

  const doctor = await resolveDoctorForChannel(inbound.channelAddress);
  if (!doctor) {
    logger.warn(
      { channelAddress: inbound.channelAddress },
      'Inbound message could not be mapped to a doctor; set DEFAULT_DOCTOR_ID or Doctor.whatsappPhoneNumberId',
    );
    return { handled: false, replies: [], reason: 'NO_DOCTOR' };
  }

  const patient = await findOrCreatePatient(inbound.from, { language: doctor.defaultLanguage });

  // Opens the 24-hour window in which we may send this patient a free-form
  // message. Stamped before the turn runs, not after: a turn that throws still
  // means the patient messaged us, and the window opened regardless.
  //
  // Per (patient, doctor): the window belongs to the business number they wrote
  // to, so it must not be credited to a clinic they have never messaged.
  await markInboundSeen(patient.id, doctor.id);

  try {
    const replies = await runTurn(doctor, patient, inbound);
    await markProcessed(inbound.providerMessageId);
    return { handled: true, replies };
  } catch (err) {
    logger.error(
      { err, phone: inbound.from, doctorId: doctor.id },
      'Conversation turn failed; sending generic error to patient',
    );

    const language = patient.language;
    const errorReply: Reply = {
      templateName: 'errorGeneric',
      text: t(language, 'errorGeneric'),
    };
    await dispatchReplies(doctor, patient, [errorReply]);

    // Deliberately not marked processed: a Meta retry gets another chance.
    return { handled: false, replies: [errorReply], reason: 'ERROR' };
  }
}

async function runTurn(
  doctor: Doctor,
  patientRow: Patient,
  inbound: InboundMessage,
): Promise<Reply[]> {
  const session = await loadSession(inbound.from, doctor.id, patientRow.language);
  const flow = flowFor(doctor.bookingMode);
  const today = clinicToday(doctor.timezone);

  let patient = patientRow;
  let language: Language = session.language;

  const baseCtx: ConversationContext = {
    doctor,
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

    // Park the patient on a step this flow understands. A doctor switching
    // booking_mode mid-session lands here too.
    const ownedStep = flow.owns(session.step) ? session.step : flow.entryStep;
    const fresh = onboarding.enterFlowFresh || ownedStep !== session.step;

    result = await flow.handle({
      ...baseCtx,
      patient,
      language,
      step: ownedStep,
      input: fresh ? '' : inbound.text,
    });
  }

  if (result.language) language = result.language;

  await saveSession({
    phone: inbound.from,
    doctorId: doctor.id,
    step: result.nextStep,
    data: result.data ?? session.data,
    language,
    patientId: patient.id,
  });

  const replies = [...prefix, ...result.replies];
  await dispatchReplies(doctor, patient, replies);
  await runEffects(result.effects ?? []);

  return replies;
}

/** Hands replies to the outbound queue — never sends inline. */
async function dispatchReplies(doctor: Doctor, patient: Patient, replies: Reply[]): Promise<void> {
  if (!replies.length) return;

  await enqueueOutboundBulk(
    replies.map((r) => ({
      to: patient.phone,
      text: r.text,
      templateName: r.templateName,
      ...(outboundChannelFor(doctor) ? { channelAddress: outboundChannelFor(doctor) } : {}),
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
