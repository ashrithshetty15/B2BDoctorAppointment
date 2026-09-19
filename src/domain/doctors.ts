import type { Doctor } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';

/**
 * Resolve which doctor an inbound message belongs to.
 *
 * The mapping is 1 WhatsApp sender number = 1 doctor. Several doctors sharing one
 * number is not supported yet; when it is, this returns a list and the flow asks
 * which doctor — solo clinics keep this exact single-result path.
 *
 * On a real provider the channel address is Meta's phone_number_id and is
 * authoritative. The DEFAULT_DOCTOR_ID and single-row fallbacks exist only for the
 * console adapter, which has no phone_number_id at all.
 */
export async function resolveDoctorForChannel(channelAddress: string): Promise<Doctor | null> {
  if (channelAddress) {
    const byChannel = await prisma.doctor.findUnique({
      where: { whatsappPhoneNumberId: channelAddress },
    });
    if (byChannel) return byChannel;

    /**
     * A real number that matches no doctor is refused rather than guessed at.
     *
     * Falling through to DEFAULT_DOCTOR_ID here would hand one clinic's patients
     * to another clinic — silently, with their phone numbers, names and booking
     * history — and the more clinics there are the likelier it gets. One
     * mis-provisioned number is all it takes.
     */
    if (env.MESSAGING_PROVIDER !== 'console') {
      logger.warn(
        { channelAddress },
        'Inbound message for an unknown phone_number_id; refusing rather than routing to a fallback doctor. Set Doctor.whatsappPhoneNumberId for this number.',
      );
      return null;
    }
  }

  if (env.DEFAULT_DOCTOR_ID) {
    return prisma.doctor.findUnique({ where: { id: env.DEFAULT_DOCTOR_ID } });
  }

  // Single-doctor deployment with nothing configured: fall back to the only row.
  const count = await prisma.doctor.count();
  if (count === 1) return prisma.doctor.findFirst();

  return null;
}

export async function getDoctorByApiKey(apiKey: string): Promise<DoctorWithChannel | null> {
  if (!apiKey) return null;
  // clinic included so every console route that later messages a patient sends
  // from the clinic's number rather than the environment fallback.
  return prisma.doctor.findUnique({ where: { apiKey }, include: { clinic: true } });
}

/**
 * A doctor with enough of their clinic loaded to know which number to send from.
 *
 * `clinic` is required, not optional, on purpose: optional would let a caller
 * forget the `include` and compile cleanly, then send that doctor's reminders
 * from the environment fallback — another clinic's number — with nothing to
 * show for it. Required turns that into a type error at the call site.
 */
export type DoctorWithChannel = Doctor & {
  clinic: { whatsappPhoneNumberId: string | null; whatsappNumber: string | null } | null;
};

/**
 * Sender address to use when messaging this doctor's patients.
 *
 * The clinic's number wins: at a multi-doctor practice only one doctor row ever
 * carried the number, so reading the doctor alone would send everyone else's
 * reminders from the environment fallback — a different clinic's number.
 *
 * Callers must load `clinic`. Falling back to the doctor's own column keeps
 * single-doctor rows working while the two coexist.
 */
export function outboundChannelFor(doctor: DoctorWithChannel): string | undefined {
  return doctor.clinic?.whatsappPhoneNumberId ?? doctor.whatsappPhoneNumberId ?? undefined;
}

/**
 * The dialable number patients message — what the QR code and the wa.me link
 * are built from.
 *
 * The clinic's wins, for the same reason as outboundChannelFor: at a
 * multi-doctor practice only one doctor row ever carried a number, so reading
 * the doctor alone leaves everyone else with no QR code at all. Falling back to
 * the doctor's own keeps a solo clinic working while both columns exist.
 */
export function bookingNumberFor(doctor: DoctorWithChannel): string | null {
  return doctor.clinic?.whatsappNumber ?? doctor.whatsappNumber ?? null;
}
