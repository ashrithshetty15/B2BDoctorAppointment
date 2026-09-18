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

export interface ClinicWithDoctors {
  clinic: Clinic;
  /** Bookable doctors, stable order so the offered numbers do not shuffle. */
  doctors: Doctor[];
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
