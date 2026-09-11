import type { ConversationSession, Language } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { Steps } from './steps';

/**
 * Conversation state store, keyed by (phone, doctor_id) exactly as the spec
 * requires. Postgres-backed: one less moving part than Redis for the MVP, and
 * the dashboard can inspect where a patient is stuck.
 */

export interface SessionSnapshot {
  step: string;
  data: Record<string, unknown>;
  language: Language;
  patientId: string | null;
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
  doctorId: string,
  fallbackLanguage: Language,
): Promise<SessionSnapshot> {
  const existing = await prisma.conversationSession.findUnique({
    where: { phone_doctor: { phone, doctorId } },
  });

  if (!existing) {
    return {
      step: Steps.ENTRY,
      data: {},
      language: fallbackLanguage,
      patientId: null,
      wasExpired: false,
    };
  }

  const expired = existing.expiresAt.getTime() <= Date.now();

  return {
    step: expired ? Steps.ENTRY : existing.step,
    data: expired ? {} : asData(existing.data),
    language: existing.language,
    patientId: existing.patientId,
    wasExpired: expired,
  };
}

export async function saveSession(input: {
  phone: string;
  doctorId: string;
  step: string;
  data: Record<string, unknown>;
  language: Language;
  patientId: string | null;
}): Promise<ConversationSession> {
  const expiresAt = ttlFromNow();

  return prisma.conversationSession.upsert({
    where: { phone_doctor: { phone: input.phone, doctorId: input.doctorId } },
    create: {
      phone: input.phone,
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
      expiresAt,
    },
  });
}

export async function resetSession(phone: string, doctorId: string): Promise<void> {
  await prisma.conversationSession
    .delete({ where: { phone_doctor: { phone, doctorId } } })
    .catch(() => undefined);
}

/** Housekeeping — safe to call from a cron. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.conversationSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
