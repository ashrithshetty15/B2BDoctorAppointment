import type { Doctor } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';

/**
 * Resolve which doctor an inbound message belongs to.
 *
 * Multi-doctor clinics are out of scope for the MVP, so the mapping is
 * 1 WhatsApp sender number = 1 doctor. DEFAULT_DOCTOR_ID covers local dev and
 * the console adapter, where there is no real phone_number_id.
 */
export async function resolveDoctorForChannel(channelAddress: string): Promise<Doctor | null> {
  if (channelAddress) {
    const byChannel = await prisma.doctor.findUnique({
      where: { whatsappPhoneNumberId: channelAddress },
    });
    if (byChannel) return byChannel;
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
