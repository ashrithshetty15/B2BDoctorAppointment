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

/**
 * Where a reading came from. A poll is the provider's opinion; a send is what
 * actually happened. They disagree, and when they do the send is right.
 */
export type HealthSource = 'poll' | 'send';

export async function recordChannelHealth(
  doctorId: string,
  health: ChannelHealth,
  now: Date = new Date(),
  source: HealthSource = 'poll',
): Promise<void> {
  const data = {
    channelStatus: health.status,
    // Cleared rather than left behind: a stale reason next to a healthy status
    // is how someone ends up chasing a problem that was fixed hours ago.
    channelReason: health.reason ?? null,
    channelErrorCode: health.code ?? null,
    channelSource: source,
    channelCheckedAt: now,
  };

  if (source === 'send') {
    await prisma.doctor.update({ where: { id: doctorId }, data });
    return;
  }

  // A poll may not talk over a send. Meta reported this clinic's account
  // AVAILABLE and its number merely LIMITED while refusing every send with
  // #131005; letting the next sweep repaint that amber would have restored the
  // exact blind spot this is here to close.
  //
  // Decided here rather than as a NOT in the query on purpose. `NOT (source =
  // 'send' AND status = 'BLOCKED')` is NULL, not true, for the rows where
  // source is still NULL — so every clinic that had never been written by a
  // send was silently excluded and stopped being refreshed at all. Three-valued
  // logic is not worth the one saved round trip.
  const current = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: { channelSource: true, channelStatus: true },
  });

  if (current?.channelSource === 'send' && current.channelStatus === 'BLOCKED') {
    // Held back by a proven failure. Still move the timestamp, so the console
    // reads "blocked, checked a minute ago" rather than implying we stopped
    // looking — the status is stale on purpose, the check is not.
    await prisma.doctor.update({ where: { id: doctorId }, data: { channelCheckedAt: now } });
    return;
  }

  await prisma.doctor.update({ where: { id: doctorId }, data });
}

/**
 * A send the provider refused on permission grounds, attributed to whichever
 * clinic sends from that number.
 *
 * This is the signal the health poll cannot give. Nothing else in the system
 * noticed that every reply was being rejected: the job threw, BullMQ backed
 * off, and the console stayed green while the queue filled with undeliverable
 * messages.
 */
export async function recordSendFailure(
  channelAddress: string,
  reason: string,
  code: number | undefined,
  now: Date = new Date(),
): Promise<void> {
  const doctor = await prisma.doctor.findUnique({
    where: { whatsappPhoneNumberId: channelAddress },
    select: { id: true },
  });
  // A send from the shared fallback number belongs to no clinic in particular;
  // there is nobody to attribute it to and guessing would be worse.
  if (!doctor) return;

  await recordChannelHealth(
    doctor.id,
    { status: 'BLOCKED', reason, ...(code !== undefined ? { code } : {}) },
    now,
    'send',
  );
}

/**
 * A send that went through, which is the only thing that can clear a failure
 * proven by a send. Scoped to rows actually parked as blocked so the common
 * case is a single indexed no-op rather than a write on every message.
 */
export async function clearSendFailure(
  channelAddress: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.doctor.updateMany({
    where: { whatsappPhoneNumberId: channelAddress, channelSource: 'send', channelStatus: 'BLOCKED' },
    data: {
      channelStatus: 'AVAILABLE',
      channelReason: null,
      channelErrorCode: null,
      channelSource: 'send',
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
