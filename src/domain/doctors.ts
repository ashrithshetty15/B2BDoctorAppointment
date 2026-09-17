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

export async function getDoctorByApiKey(apiKey: string): Promise<Doctor | null> {
  if (!apiKey) return null;
  return prisma.doctor.findUnique({ where: { apiKey } });
}

/** Sender address to use when messaging this doctor's patients. */
export function outboundChannelFor(doctor: Doctor): string | undefined {
  return doctor.whatsappPhoneNumberId ?? undefined;
}
