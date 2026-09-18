import type { ConversationSession, Language } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { Steps } from './steps';

/**
 * Conversation state store, keyed by (phone, clinic_id).
 *
 * Keyed on the clinic rather than the doctor because the patient messages a
 * practice: at a clinic with several doctors there is no doctor yet when the
 * first turn arrives, and which one they pick is part of the conversation, not
 * part of its identity. `doctorId` below is therefore state, and null until
 * they choose — a solo clinic has it set on the first turn and never asks.
 *
 * Postgres-backed: one less moving part than Redis for the MVP, and the
 * dashboard can inspect where a patient is stuck.
 */

export interface SessionSnapshot {
  step: string;
  data: Record<string, unknown>;
  language: Language;
  patientId: string | null;
  /** The doctor chosen earlier in this conversation, if any. */
  doctorId: string | null;
  /** True when the previous session had expired and was reset this turn. */
  wasExpired: boolean;
}

function ttlFromNow(): Date {
  return new Date(Date.now() + env.SESSION_TTL_MINUTES * 60_000);
}

function asData(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function loadSession(
  phone: string,
  clinicId: string,
  fallbackLanguage: Language,
): Promise<SessionSnapshot> {
  const existing = await prisma.conversationSession.findUnique({
    where: { phone_clinic: { phone, clinicId } },
  });

  if (!existing) {
    return {
      step: Steps.ENTRY,
      data: {},
      language: fallbackLanguage,
      patientId: null,
      doctorId: null,
      wasExpired: false,
    };
  }

  const expired = existing.expiresAt.getTime() <= Date.now();

  return {
    step: expired ? Steps.ENTRY : existing.step,
    data: expired ? {} : asData(existing.data),
    language: existing.language,
    patientId: existing.patientId,
    // An expired session forgets the doctor too: after two hours away, the
    // patient may well want a different one, and assuming otherwise books
    // them with someone they did not choose this time.
    doctorId: expired ? null : existing.doctorId,
    wasExpired: expired,
  };
}

export async function saveSession(input: {
  phone: string;
  clinicId: string;
  doctorId: string | null;
  step: string;
  data: Record<string, unknown>;
  language: Language;
  patientId: string | null;
}): Promise<ConversationSession> {
  const expiresAt = ttlFromNow();

  return prisma.conversationSession.upsert({
    where: { phone_clinic: { phone: input.phone, clinicId: input.clinicId } },
    create: {
      phone: input.phone,
      clinicId: input.clinicId,
      doctorId: input.doctorId,
      step: input.step,
      data: input.data as object,
      language: input.language,
      patientId: input.patientId,
      expiresAt,
    },
    update: {
      step: input.step,
      data: input.data as object,
      language: input.language,
      patientId: input.patientId,
      doctorId: input.doctorId,
      expiresAt,
    },
  });
}

export async function resetSession(phone: string, clinicId: string): Promise<void> {
  await prisma.conversationSession
    .delete({ where: { phone_clinic: { phone, clinicId } } })
    .catch(() => undefined);
}

/** Housekeeping — safe to call from a cron. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.conversationSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
