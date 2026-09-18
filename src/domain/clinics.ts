import crypto from 'node:crypto';
import type { Clinic, Doctor } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
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
  if (!existing.whatsappPhoneNumberId && input.whatsappPhoneNumberId) {
    return prisma.clinic.update({
      where: { id: existing.id },
      data: {
        whatsappPhoneNumberId: input.whatsappPhoneNumberId,
        ...(input.whatsappNumber ? { whatsappNumber: input.whatsappNumber } : {}),
      },
    });
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
): Promise<ClinicWithDoctors | null> {
  const clinic = await findClinic(channelAddress);
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

async function findClinic(channelAddress: string): Promise<Clinic | null> {
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

/** Sender address to use when messaging this clinic's patients. */
export function outboundChannelForClinic(clinic: Clinic): string | undefined {
  return clinic.whatsappPhoneNumberId ?? undefined;
}
