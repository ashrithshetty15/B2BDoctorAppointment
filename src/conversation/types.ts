import type { Doctor, Language, Patient } from '@prisma/client';
import type { TemplateName } from '../i18n/templates';

/**
 * The state machine's world. Note what is absent: no adapter, no HTTP, no Meta
 * payloads. A flow receives this, returns a StepResult, and is fully testable
 * without a messaging provider (requirement 8).
 */
export interface ConversationContext {
  doctor: Doctor;
  patient: Patient;
  /** Current step the patient is parked on. */
  step: string;
  /** Per-step scratch data persisted alongside the step. */
  data: Record<string, unknown>;
  language: Language;
  /** Patient's message, already normalised to text by the adapter. */
  input: string;
  receivedAt: Date;
  /** "today" in the doctor's timezone, as a date-only value. */
  today: Date;
}

/** One outbound message the flow wants sent, in order. */
export interface Reply {
  text: string;
  /** Carried for logging/analytics only. */
  templateName: TemplateName;
}

export interface StepResult {
  /** Step to park the patient on after this turn. */
  nextStep: string;
  replies: Reply[];
  /** Replaces session data when present. */
  data?: Record<string, unknown>;
  /** Persist a language change on both session and patient. */
  language?: Language;
  /**
   * Side effects the engine must perform after the session is saved. Flows
   * declare them instead of doing them, so a flow stays a pure decision.
   */
  effects?: Effect[];
}

export type Effect =
  | { type: 'RECALC_TOKEN_QUEUE'; doctorId: string; date: Date; originAppointmentId?: string }
  | { type: 'CANCEL_REMINDERS'; appointmentId: string }
  | { type: 'SCHEDULE_REMINDERS'; appointmentId: string };

/** A flow handles one booking mode. */
export interface ConversationFlow {
  /** Step this flow parks patients on once onboarding is complete. */
  readonly entryStep: string;
  /** True if this flow owns the given step name. */
  owns(step: string): boolean;
  handle(ctx: ConversationContext): Promise<StepResult>;
}

export function reply(templateName: TemplateName, text: string): Reply {
  return { templateName, text };
}
