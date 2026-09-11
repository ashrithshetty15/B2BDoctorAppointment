import { Queue, type JobsOptions } from 'bullmq';
import { getRedis } from './connection';
import { formatDateOnly } from '../utils/time';

export const QUEUE_OUTBOUND = 'outbound-messages';
export const QUEUE_TOKEN_EVENTS = 'token-queue-events';
export const QUEUE_REMINDERS = 'appointment-reminders';

// ---- Job payloads ----

export interface OutboundJob {
  to: string;
  text: string;
  /** Provider sender address (Meta phone_number_id). */
  channelAddress?: string;
  /** Diagnostics only. */
  templateName?: string;
}

/**
 * "Something changed in this doctor's token queue today — recompute everyone's
 * position and notify whoever moved."
 */
export interface TokenEventJob {
  doctorId: string;
  /** YYYY-MM-DD */
  date: string;
  trigger:
    | 'BOOKING_CREATED'
    | 'BOOKING_CANCELLED'
    | 'STATUS_CHANGED'
    | 'DELAY_ANNOUNCED'
    | 'MANUAL';
  /** Appointment that triggered this, so it can be skipped in the broadcast. */
  originAppointmentId?: string;
}

export type ReminderKind = 'DAY_BEFORE' | 'HOUR_BEFORE';

export type ReminderJob =
  /** Fire one reminder for one appointment. */
  | { kind: ReminderKind; appointmentId: string }
  /**
   * Safety net: scan the Appointment table for reminders that are due but never
   * fired (rows created while the worker was down, or a flushed Redis).
   */
  | { kind: 'SWEEP' };

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

let outboundQueue: Queue<OutboundJob> | null = null;
let tokenEventsQueue: Queue<TokenEventJob> | null = null;
let remindersQueue: Queue<ReminderJob> | null = null;

export function getOutboundQueue(): Queue<OutboundJob> {
  if (!outboundQueue) {
    outboundQueue = new Queue<OutboundJob>(QUEUE_OUTBOUND, {
      connection: getRedis(),
      defaultJobOptions,
    });
  }
  return outboundQueue;
}

export function getTokenEventsQueue(): Queue<TokenEventJob> {
  if (!tokenEventsQueue) {
    tokenEventsQueue = new Queue<TokenEventJob>(QUEUE_TOKEN_EVENTS, {
      connection: getRedis(),
      defaultJobOptions,
    });
  }
  return tokenEventsQueue;
}

export function getRemindersQueue(): Queue<ReminderJob> {
  if (!remindersQueue) {
    remindersQueue = new Queue<ReminderJob>(QUEUE_REMINDERS, {
      connection: getRedis(),
      defaultJobOptions,
    });
  }
  return remindersQueue;
}

// ---- Producers ----

/** All patient-facing sends go through here — never call the adapter inline. */
export async function enqueueOutbound(job: OutboundJob): Promise<void> {
  await getOutboundQueue().add('send', job);
}

export async function enqueueOutboundBulk(jobs: OutboundJob[]): Promise<void> {
  if (!jobs.length) return;
  await getOutboundQueue().addBulk(jobs.map((data) => ({ name: 'send', data })));
}

/**
 * Ask for a queue recalculation + position broadcast.
 *
 * Debounced: a 2s delay plus a per-(doctor,date,trigger) job id means a burst of
 * status changes collapses into one broadcast instead of spamming patients.
 */
export async function enqueueTokenQueueRecalc(job: {
  doctorId: string;
  date: Date;
  trigger: TokenEventJob['trigger'];
  originAppointmentId?: string;
}): Promise<void> {
  const dateKey = formatDateOnly(job.date);
  await getTokenEventsQueue().add(
    'recalc',
    {
      doctorId: job.doctorId,
      date: dateKey,
      trigger: job.trigger,
      ...(job.originAppointmentId ? { originAppointmentId: job.originAppointmentId } : {}),
    },
    {
      delay: 2_000,
      jobId: `recalc:${job.doctorId}:${dateKey}:${job.trigger}:${bucket()}`,
    },
  );
}

/** 10-second debounce bucket for the dedupe job id. */
function bucket(): number {
  return Math.floor(Date.now() / 10_000);
}

export async function scheduleReminder(
  job: { kind: ReminderKind; appointmentId: string },
  fireAt: Date,
): Promise<void> {
  const delay = fireAt.getTime() - Date.now();
  if (delay <= 0) return; // in the past — nothing to schedule

  await getRemindersQueue().add('remind', job, {
    delay,
    // Stable id: rescheduling the same reminder replaces rather than duplicates.
    jobId: `reminder:${job.kind}:${job.appointmentId}`,
  });
}

/** Register the every-10-minutes reminder sweep. Idempotent. */
export async function registerReminderSweep(): Promise<void> {
  await getRemindersQueue().add(
    'sweep',
    { kind: 'SWEEP' },
    {
      repeat: { pattern: '*/10 * * * *' },
      jobId: 'reminder-sweep',
      removeOnComplete: { count: 20 },
    },
  );
}

export async function cancelReminders(appointmentId: string): Promise<void> {
  const q = getRemindersQueue();
  await Promise.all(
    (['DAY_BEFORE', 'HOUR_BEFORE'] as const).map(async (kind) => {
      const job = await q.getJob(`reminder:${kind}:${appointmentId}`);
      if (job) await job.remove().catch(() => undefined);
    }),
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    outboundQueue?.close(),
    tokenEventsQueue?.close(),
    remindersQueue?.close(),
  ]);
  outboundQueue = null;
  tokenEventsQueue = null;
  remindersQueue = null;
}
