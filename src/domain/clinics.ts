import crypto from 'node:crypto';
import type { Clinic, Doctor, Language } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { parseClinicCode } from './clinicCode';
import { resolveSharedNumberClinic } from './sharedNumberRouting';
import { logger } from '../utils/logger';

/**
 * Resolving an inbound WhatsApp number to the practice behind it.
 *
 * The number identifies a *clinic*, not a doctor. Meta allows twenty numbers
 * per WABA, so one number per doctor puts a five-doctor practice at a quarter
 * of a WABA; one per clinic is what makes a hundred clinics fit. Which doctor
 * the patient wants is then a question the bot asks, and a solo practice never
 * sees it.
 */

/**
 * How many doctors one clinic may hold.
 *
 * Five is a product decision, but it also keeps the picker honest: WhatsApp
 * allows ten list rows and the adapter silently drops the rest, so a clinic
 * past ten would lose doctors from the menu with nothing to show for it. Five
 * stays well inside that, and a five-item list is still a glance rather than a
 * scroll.
 */
export const MAX_DOCTORS_PER_CLINIC = 5;

export interface ClinicWithDoctors {
  clinic: Clinic;
  /** Bookable doctors, stable order so the offered numbers do not shuffle. */
  doctors: Doctor[];
}

export class ClinicFullError extends Error {
  constructor(readonly clinicName: string) {
    super(
      `${clinicName} already has ${MAX_DOCTORS_PER_CLINIC} doctors, which is the limit. Disable one before adding another.`,
    );
    this.name = 'ClinicFullError';
  }
}

/**
 * The clinic a newly created doctor belongs to, made if it does not exist.
 *
 * Grouped by name, which is what the create form already collects. Two doctors
 * typed with the same clinic name land in the same practice and therefore share
 * its number — which is the whole point, and was not true before: every doctor
 * created this way used to belong to no clinic at all and was unreachable.
 *
 * Throws when the clinic is full, so the caller reports it rather than silently
 * creating a doctor nobody can book.
 */
export async function clinicForNewDoctor(input: {
  clinicName: string;
  whatsappPhoneNumberId?: string | undefined;
  whatsappNumber?: string | undefined;
  missedCallNumber?: string | undefined;
  timezone?: string | undefined;
  defaultLanguage?: 'EN' | 'KN' | undefined;
}): Promise<Clinic> {
  // Number first — it is unique and authoritative — then the name. Both are
  // needed: looking up only by number would create a *second* clinic of the
  // same name whenever the first was set up before it had a number, which is
  // exactly how a practice ends up split in two with one half unroutable.
  const byNumber = input.whatsappPhoneNumberId
    ? await prisma.clinic.findUnique({
        where: { whatsappPhoneNumberId: input.whatsappPhoneNumberId },
      })
    : null;
  const existing =
    byNumber ?? (await prisma.clinic.findFirst({ where: { name: input.clinicName } }));

  if (!existing) {
    return prisma.clinic.create({
      data: {
        name: input.clinicName,
        ...(input.whatsappPhoneNumberId
          ? { whatsappPhoneNumberId: input.whatsappPhoneNumberId }
          : {}),
        ...(input.whatsappNumber ? { whatsappNumber: input.whatsappNumber } : {}),
        ...(input.missedCallNumber ? { missedCallNumber: input.missedCallNumber } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.defaultLanguage ? { defaultLanguage: input.defaultLanguage } : {}),
        apiKey: `ck_${crypto.randomBytes(16).toString('hex')}`,
      },
    });
  }

  const count = await prisma.doctor.count({ where: { clinicId: existing.id } });
  if (count >= MAX_DOCTORS_PER_CLINIC) throw new ClinicFullError(existing.name);

  // A clinic created before it had a number of its own adopts the one supplied
  // with this doctor, rather than leaving the practice unroutable.
  //
  // Each key is adopted independently. Bundling them behind a single
  // `!existing.whatsappPhoneNumberId` test is what left a clinic with a WhatsApp
  // number but no missed-call number: the second doctor supplied the ExoPhone,
  // the branch was already satisfied, and the value was dropped on the floor.
  const adopt = {
    ...(!existing.whatsappPhoneNumberId && input.whatsappPhoneNumberId
      ? { whatsappPhoneNumberId: input.whatsappPhoneNumberId }
      : {}),
    ...(!existing.whatsappNumber && input.whatsappNumber
      ? { whatsappNumber: input.whatsappNumber }
      : {}),
    ...(!existing.missedCallNumber && input.missedCallNumber
      ? { missedCallNumber: input.missedCallNumber }
      : {}),
  };

  if (Object.keys(adopt).length > 0) {
    return prisma.clinic.update({ where: { id: existing.id }, data: adopt });
  }

  return existing;
}

export async function activeDoctors(clinicId: string): Promise<Doctor[]> {
  return prisma.doctor.findMany({
    where: { clinicId, status: 'ACTIVE' },
    orderBy: [{ name: 'asc' }],
  });
}

export async function resolveClinicForChannel(
  channelAddress: string,
  inbound?: { text: string; phone: string },
): Promise<ClinicWithDoctors | null> {
  const clinic = await findClinic(channelAddress, inbound);
  if (!clinic) return null;

  const doctors = await activeDoctors(clinic.id);
  if (doctors.length === 0) {
    // A clinic whose doctors are all disabled has nothing to offer. Better to
    // say nothing than to route into a flow with no doctor behind it.
    logger.warn({ clinic: clinic.name }, 'Clinic has no active doctors; ignoring inbound');
    return null;
  }

  return { clinic, doctors };
}


/**
 * Resolving a clinic on the shared platform number.
 *
 * The deeplink's code is the only thing in an inbound message that can name a
 * clinic, and it arrives once — on the first message. After that the session
 * carries it, and a patient with history can be recognised without one.
 *
 * The ASK case returns null deliberately rather than guessing: the engine then
 * declines to handle the turn, exactly as it does for an unknown number. Asking
 * the patient which clinic they mean is a conversation, and it belongs in a
 * flow rather than in a routing function that can only answer yes or no.
 */
async function findClinicOnSharedNumber(text: string, phone: string): Promise<Clinic | null> {
  const code = parseClinicCode(text);

  const [byCode, liveSession, priorIds] = await Promise.all([
    code ? prisma.clinic.findUnique({ where: { code } }) : Promise.resolve(null),
    prisma.conversationSession.findFirst({
      where: { phone, expiresAt: { gt: new Date() }, clinicId: { not: null } },
      orderBy: { updatedAt: 'desc' },
      select: { clinicId: true },
    }),
    clinicsPatientHasUsed(phone),
  ]);

  const decision = resolveSharedNumberClinic({
    codeInText: code,
    clinicForCode: byCode?.id ?? null,
    sessionClinicId: liveSession?.clinicId ?? null,
    priorClinicIds: priorIds,
  });

  switch (decision.kind) {
    case 'CODE':
    case 'SESSION':
    case 'ONLY_PRIOR':
      return prisma.clinic.findUnique({ where: { id: decision.clinicId } });
    case 'ASK':
      logger.info({ phone, choices: decision.choices.length }, 'Shared number: patient uses several clinics');
      return null;
    default:
      logger.info({ phone }, 'Shared number: no code and no history; patient needs their clinic link');
      return null;
  }
}

/**
 * Why the shared number could not name a clinic, and what to say about it.
 *
 * Returns null when this is not the platform number: an unknown number stays
 * silent, because there is no clinic whose voice we could answer in. On the
 * platform number there is — the platform is the sender, and a patient who
 * writes in without a code has reached *us*, not nobody. Silence there is a
 * dead end, and this is the number printed on cards and QR codes, so cold
 * messages are expected traffic rather than an error.
 *
 * Only called after resolution has already failed, so the extra queries land on
 * the rare path and the happy path pays nothing.
 */
export async function sharedNumberPrompt(
  channelAddress: string,
  phone: string,
): Promise<{ clinicNames: string[]; language: Language } | null> {
  if (!channelAddress || channelAddress !== env.PLATFORM_PHONE_NUMBER_ID) return null;

  const patient = await prisma.patient.findUnique({
    where: { phone },
    select: { id: true, language: true },
  });
  const priorIds = patient ? await clinicIdsForPatient(patient.id) : [];

  // Named only when there is a real choice to put to them. One prior clinic
  // would have resolved already, and none means they have no history to list.
  const clinics =
    priorIds.length > 1
      ? await prisma.clinic.findMany({
          where: { id: { in: priorIds } },
          select: { id: true, name: true },
        })
      : [];

  return {
    // Most recent first, matching the order the resolver considered them in.
    clinicNames: priorIds
      .map((id) => clinics.find((c) => c.id === id)?.name)
      .filter((n): n is string => Boolean(n)),
    language: patient?.language ?? 'EN',
  };
}

/** Clinics this phone has booked with, most recent first. */
async function clinicsPatientHasUsed(phone: string): Promise<string[]> {
  const patient = await prisma.patient.findUnique({ where: { phone }, select: { id: true } });
  if (!patient) return [];

  return clinicIdsForPatient(patient.id);
}

async function clinicIdsForPatient(patientId: string): Promise<string[]> {
  const appointments = await prisma.appointment.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    select: { doctor: { select: { clinicId: true } } },
    take: 50,
  });

  const seen: string[] = [];
  for (const a of appointments) {
    const id = a.doctor.clinicId;
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

async function findClinic(
  channelAddress: string,
  inbound?: { text: string; phone: string },
): Promise<Clinic | null> {
  /**
   * The shared platform number, if this message arrived on it.
   *
   * Checked first and separately because this number belongs to no clinic: a
   * lookup by phone_number_id would find nothing and fall through to the
   * refusal below, which is correct for an unknown number and wrong for this
   * one. Clinics with their own number never reach this branch.
   */
  if (channelAddress && channelAddress === env.PLATFORM_PHONE_NUMBER_ID && inbound) {
    return findClinicOnSharedNumber(inbound.text, inbound.phone);
  }

  if (channelAddress) {
    const byChannel = await prisma.clinic.findUnique({
      where: { whatsappPhoneNumberId: channelAddress },
    });
    if (byChannel) return byChannel;

    // Transitional: the number may still only be on the doctor row, if this is
    // running between the migration and the backfill. Removed once every clinic
    // carries its own number.
    const legacy = await prisma.doctor.findUnique({
      where: { whatsappPhoneNumberId: channelAddress },
      include: { clinic: true },
    });
    if (legacy?.clinic) return legacy.clinic;

    /**
     * A real number matching no clinic is refused rather than guessed at.
     *
     * Falling through to a default here would hand one clinic's patients to
     * another — silently, with their phone numbers, names and booking history.
     * One mis-provisioned number is all it takes.
     */
    if (env.MESSAGING_PROVIDER !== 'console') {
      logger.warn(
        { channelAddress },
        'Inbound message for an unknown phone_number_id; refusing rather than routing to a fallback clinic. Set Clinic.whatsappPhoneNumberId for this number.',
      );
      return null;
    }
  }

  // Console adapter only: there is no phone_number_id to route on.
  if (env.DEFAULT_DOCTOR_ID) {
    const d = await prisma.doctor.findUnique({
      where: { id: env.DEFAULT_DOCTOR_ID },
      include: { clinic: true },
    });
    if (d?.clinic) return d.clinic;
  }

  const count = await prisma.clinic.count();
  if (count === 1) return prisma.clinic.findFirst();

  return null;
}

/**
 * Sender address to use when messaging this clinic's patients.
 *
 * A clinic with no number of its own is, by definition, one the shared platform
 * number serves — so that is who its messages must come from. Without this the
 * send falls through to the global default sender, which is a different number
 * entirely: in this deployment the +1 555 test number, so every reply to a
 * shared-number clinic would arrive from a US test line, if it arrived at all.
 *
 * Unset PLATFORM_PHONE_NUMBER_ID and this is exactly the old behaviour.
 */
export function outboundChannelForClinic(clinic: Clinic): string | undefined {
  return clinic.whatsappPhoneNumberId ?? env.PLATFORM_PHONE_NUMBER_ID ?? undefined;
}

/** The front-desk key: one sign-in covering every doctor at a clinic. */
export async function clinicByApiKey(apiKey: string): Promise<Clinic | null> {
  if (!apiKey) return null;
  return prisma.clinic.findUnique({ where: { apiKey } });
}
