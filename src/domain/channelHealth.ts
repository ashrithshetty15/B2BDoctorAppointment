import { prisma } from '../db/prisma';
import { getMessagingAdapter } from '../messaging';
import type { ChannelHealth } from '../messaging/types';
import { logger } from '../utils/logger';

/**
 * Keeping each clinic's channel health fresh enough to act on.
 *
 * Polled rather than pushed: the provider has no "your account broke" webhook,
 * and the failures that matter (unpaid account, unapproved display name, a
 * missing asset grant) are states rather than events.
 */

/**
 * How stale a reading may be before it is refreshed. Bounds the call volume —
 * at 100 clinics this is roughly 400 provider calls an hour — while keeping the
 * console current enough that nobody is debugging blind for a morning.
 */
export const HEALTH_TTL_MINUTES = 15;

export function isStale(checkedAt: Date | null, now: Date, ttlMinutes = HEALTH_TTL_MINUTES): boolean {
  if (!checkedAt) return true;
  return now.getTime() - checkedAt.getTime() >= ttlMinutes * 60_000;
}

/** True when this reading means patients are not receiving messages. */
export function isFailing(status: string | null): boolean {
  return status === 'BLOCKED' || status === 'UNKNOWN';
}

export async function recordChannelHealth(
  doctorId: string,
  health: ChannelHealth,
  now: Date = new Date(),
): Promise<void> {
  await prisma.doctor.update({
    where: { id: doctorId },
    data: {
      channelStatus: health.status,
      // Cleared rather than left behind: a stale reason next to a healthy status
      // is how someone ends up chasing a problem that was fixed hours ago.
      channelReason: health.reason ?? null,
      channelErrorCode: health.code ?? null,
      channelCheckedAt: now,
    },
  });
}

/**
 * Refresh every clinic whose reading has gone stale.
 *
 * Only doctors with a channel of their own are checked — one without a
 * phone_number_id has nothing to be healthy or unhealthy about.
 */
export async function sweepChannelHealth(now: Date = new Date()): Promise<number> {
  const adapter = getMessagingAdapter();
  if (!adapter.getChannelHealth) return 0;

  const doctors = await prisma.doctor.findMany({
    where: { whatsappPhoneNumberId: { not: null }, status: 'ACTIVE' },
    select: { id: true, clinicName: true, whatsappPhoneNumberId: true, channelCheckedAt: true },
  });

  let checked = 0;
  for (const doctor of doctors) {
    if (!isStale(doctor.channelCheckedAt, now)) continue;

    try {
      const health = await adapter.getChannelHealth(doctor.whatsappPhoneNumberId!);
      await recordChannelHealth(doctor.id, health, now);
      checked += 1;

      if (health.status !== 'AVAILABLE') {
        logger.warn(
          { clinic: doctor.clinicName, status: health.status, code: health.code, reason: health.reason },
          'Clinic WhatsApp channel is not fully healthy',
        );
      }
    } catch (err) {
      // One clinic's failure must not stop the rest being checked.
      logger.warn({ err, doctorId: doctor.id }, 'Channel health refresh failed');
    }
  }

  return checked;
}
