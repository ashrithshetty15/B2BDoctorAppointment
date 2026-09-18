import type { Doctor, Language } from '@prisma/client';
import { cancelAppointment } from '../../domain/appointments';
import {
  bookSlot,
  getAvailableSlots,
  getNextAvailableDates,
  slotLabel,
  type Slot,
} from '../../domain/slots';
import { t } from '../../i18n/templates';
import type { ListRow, ReplyButton } from '../../messaging/types';
import { formatDateForPatient, formatDateOnly, parseDateOnly } from '../../utils/time';
import { isNo, isYes, numericChoice } from '../intent';
import { Steps } from '../steps';
import {
  reply,
  replyWithList,
  type ConversationContext,
  type ConversationFlow,
  type Reply,
  type StepResult,
} from '../types';

/**
 * SLOT MODE: book a specific appointment time.
 *
 * Mirrors tokenFlow's shape — a switch over ctx.step, menuResult() as the reset
 * target, and session `data` carrying the in-progress choice.
 *
 * Availability is derived live on every read by domain/slots.ts rather than
 * held anywhere, which is what keeps WhatsApp and the desk calendar from ever
 * disagreeing. The cost is that a time offered at the top of a conversation can
 * be gone by the time the patient confirms, so TAKEN is a normal outcome here,
 * not an edge case — it re-offers rather than apologising.
 */

/** Dates offered at once. Meta allows ten list rows; leave room for nothing else. */
const DATE_PAGE = 8;

/**
 * Times per page. Nine leaves the tenth row for "more times" — a clinic running
 * 10-minute consults over a morning has more than twenty slots, and a list
 * cannot hold them.
 */
const TIME_PAGE = 9;

const MORE = 'more';

interface SlotData {
  /** YYYY-MM-DD. Stored as a date, never an index into a regenerated list. */
  date?: string;
  /** Offset into the day's available times, for paging. */
  offset?: number;
  /** ISO instant of the time being confirmed. */
  slotStart?: string;
}

function readData(ctx: ConversationContext): SlotData {
  return (ctx.data ?? {}) as SlotData;
}

function confirmButtons(language: Language): ReplyButton[] {
  return [
    { id: '1', title: t(language, 'btnYes') },
    { id: '2', title: t(language, 'btnNo') },
  ];
}

/** "1. Fri, 18 Sep" lines, matching the numbers used as list-row ids. */
function numberedLines(labels: string[]): string {
  return labels.map((label, i) => `${i + 1}. ${label}`).join('\n');
}

// ---- menu ----

async function menuResult(ctx: ConversationContext, extraFirst?: Reply[]): Promise<StepResult> {
  return {
    nextStep: Steps.SLOT_MENU,
    replies: [
      ...(extraFirst ?? []),
      reply('slotMainMenu', t(ctx.language, 'slotMainMenu', { doctorName: ctx.doctor.name }), [
        { id: '1', title: t(ctx.language, 'btnBookSlot') },
        { id: '2', title: t(ctx.language, 'btnMyAppointment') },
        { id: '3', title: t(ctx.language, 'btnCancelSlot') },
      ]),
    ],
    data: {},
  };
}

// ---- date picking ----

async function askForDate(ctx: ConversationContext, extraFirst?: Reply[]): Promise<StepResult> {
  const dates = await getNextAvailableDates(ctx.doctor, ctx.today, DATE_PAGE);

  if (dates.length === 0) {
    // No free day inside the look-ahead window — send them back to the menu
    // rather than parking them on a list with nothing in it.
    return menuResult(ctx, [
      reply(
        'slotNoneAvailable',
        t(ctx.language, 'slotNoneAvailable', { date: formatDateForPatient(ctx.today) }),
      ),
    ]);
  }

  const labels = dates.map((d) => formatDateForPatient(d));
  const rows: ListRow[] = dates.map((d, i) => ({
    id: String(i + 1),
    title: labels[i]!,
  }));

  return {
    nextStep: Steps.SLOT_AWAITING_DATE,
    replies: [
      ...(extraFirst ?? []),
      replyWithList(
        'slotPickDate',
        t(ctx.language, 'slotPickDate', { options: numberedLines(labels) }),
        t(ctx.language, 'btnChooseDate'),
        rows,
      ),
    ],
    // The chosen dates are re-derived on the next turn from this list, so store
    // the dates themselves rather than trusting the ordering to survive.
    data: { dates: dates.map(formatDateOnly) },
  };
}

async function handleDateChoice(ctx: ConversationContext): Promise<StepResult> {
  const offered = ((ctx.data?.['dates'] as string[]) ?? []).slice();
  const choice = numericChoice(ctx.input);

  if (choice === null || choice < 1 || choice > offered.length) {
    return {
      nextStep: Steps.SLOT_AWAITING_DATE,
      replies: [reply('slotInvalidChoice', t(ctx.language, 'slotInvalidChoice'))],
      data: ctx.data,
    };
  }

  return askForTime(ctx, offered[choice - 1]!, 0);
}

// ---- time picking ----

async function askForTime(
  ctx: ConversationContext,
  dateKey: string,
  offset: number,
  extraFirst?: Reply[],
): Promise<StepResult> {
  const date = parseDateOnly(dateKey);
  if (!date) return menuResult(ctx);

  const all = await getAvailableSlots(ctx.doctor, date, ctx.receivedAt);
  if (all.length === 0) {
    // Everything went while they were deciding. Back to the dates.
    return askForDate(ctx, [
      reply('slotNoneAvailable', t(ctx.language, 'slotNoneAvailable', {
        date: formatDateForPatient(date),
      })),
    ]);
  }

  const page = all.slice(offset, offset + TIME_PAGE);
  const hasMore = all.length > offset + TIME_PAGE;
  const labels = page.map((s) => slotLabel(s, ctx.doctor.timezone));

  const rows: ListRow[] = page.map((_, i) => ({
    id: String(i + 1),
    title: labels[i]!,
  }));
  if (hasMore) rows.push({ id: MORE, title: t(ctx.language, 'btnMoreTimes') });

  const body = t(ctx.language, 'slotPickTime', {
    date: formatDateForPatient(date),
    options: numberedLines(labels) + (hasMore ? `\n\n${t(ctx.language, 'btnMoreTimes')}` : ''),
  });

  return {
    nextStep: Steps.SLOT_AWAITING_TIME,
    replies: [
      ...(extraFirst ?? []),
      replyWithList('slotPickTime', body, t(ctx.language, 'btnChooseTime'), rows),
    ],
    // Times are stored as instants: re-deriving by index on the next turn would
    // silently shift if a slot were booked in between.
    data: {
      date: dateKey,
      offset,
      times: page.map((s: Slot) => s.start.toISOString()),
      hasMore,
    },
  };
}

async function handleTimeChoice(ctx: ConversationContext): Promise<StepResult> {
  const data = readData(ctx);
  const times = ((ctx.data?.['times'] as string[]) ?? []).slice();
  const input = ctx.input.trim().toLowerCase();

  if (!data.date) return menuResult(ctx);

  if (input === MORE && ctx.data?.['hasMore']) {
    return askForTime(ctx, data.date, (data.offset ?? 0) + TIME_PAGE);
  }

  const choice = numericChoice(ctx.input);
  if (choice === null || choice < 1 || choice > times.length) {
    return {
      nextStep: Steps.SLOT_AWAITING_TIME,
      replies: [reply('slotInvalidChoice', t(ctx.language, 'slotInvalidChoice'))],
      data: ctx.data,
    };
  }

  const slotStart = times[choice - 1]!;
  const date = parseDateOnly(data.date);
  if (!date) return menuResult(ctx);

  return {
    nextStep: Steps.SLOT_CONFIRM_BOOKING,
    replies: [
      reply(
        'slotConfirmPrompt',
        t(ctx.language, 'slotConfirmPrompt', {
          doctorName: ctx.doctor.name,
          date: formatDateForPatient(date),
          time: timeLabel(new Date(slotStart), ctx.doctor),
        }),
        confirmButtons(ctx.language),
      ),
    ],
    data: { date: data.date, slotStart },
  };
}

function timeLabel(at: Date, doctor: Doctor): string {
  return slotLabel({ start: at, end: at }, doctor.timezone);
}

// ---- confirming ----

async function handleBookingConfirmation(ctx: ConversationContext): Promise<StepResult> {
  if (isNo(ctx.input)) return menuResult(ctx);

  const data = readData(ctx);
  if (!data.date || !data.slotStart) return menuResult(ctx);

  if (!isYes(ctx.input)) {
    // Re-ask rather than silently dropping the booking.
    const date = parseDateOnly(data.date);
    return {
      nextStep: Steps.SLOT_CONFIRM_BOOKING,
      replies: [
        reply('unknownInput', t(ctx.language, 'unknownInput')),
        reply(
          'slotConfirmPrompt',
          t(ctx.language, 'slotConfirmPrompt', {
            doctorName: ctx.doctor.name,
            date: date ? formatDateForPatient(date) : '',
            time: timeLabel(new Date(data.slotStart), ctx.doctor),
          }),
          confirmButtons(ctx.language),
        ),
      ],
      data: ctx.data,
    };
  }

  const date = parseDateOnly(data.date);
  if (!date) return menuResult(ctx);

  const result = await bookSlot(
    ctx.doctor,
    ctx.patient.id,
    date,
    new Date(data.slotStart),
    ctx.receivedAt,
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'TAKEN':
        // Somebody booked it mid-conversation. Expected, given availability is
        // derived live — re-offer the day rather than dead-ending.
        return askForTime(ctx, data.date, 0, [
          reply('slotTaken', t(ctx.language, 'slotTaken')),
        ]);
      case 'PATIENT_HAS_SLOT':
        return menuResult(ctx, [
          reply(
            'slotAlreadyBooked',
            t(ctx.language, 'slotAlreadyBooked', {
              date: formatDateForPatient(date),
              time: timeLabel(new Date(data.slotStart), ctx.doctor),
            }),
          ),
        ]);
      case 'ON_LEAVE':
        return menuResult(ctx, [
          reply(
            'doctorOnLeave',
            t(ctx.language, 'doctorOnLeave', {
              doctorName: ctx.doctor.name,
              date: formatDateForPatient(date),
            }),
          ),
        ]);
      case 'IN_PAST':
      case 'NOT_A_SLOT':
      default:
        // The offered time expired or never existed — start the day again.
        return askForTime(ctx, data.date, 0, [
          reply('slotInvalidChoice', t(ctx.language, 'slotInvalidChoice')),
        ]);
    }
  }

  const appointment = result.appointment;
  const time = appointment.slotStart
    ? timeLabel(appointment.slotStart, ctx.doctor)
    : timeLabel(new Date(data.slotStart), ctx.doctor);

  if (result.alreadyExisted) {
    return menuResult(ctx, [
      reply(
        'slotAlreadyBooked',
        t(ctx.language, 'slotAlreadyBooked', {
          date: formatDateForPatient(appointment.date),
          time,
        }),
      ),
    ]);
  }

  return {
    nextStep: Steps.SLOT_MENU,
    replies: [
      reply(
        'slotBooked',
        t(ctx.language, 'slotBooked', {
          doctorName: ctx.doctor.name,
          clinicName: ctx.doctor.clinicName,
          date: formatDateForPatient(appointment.date),
          time,
        }),
      ),
    ],
    data: {},
    effects: [{ type: 'SCHEDULE_REMINDERS', appointmentId: appointment.id }],
  };
}

// ---- status and cancellation ----

async function showStatus(ctx: ConversationContext): Promise<StepResult> {
  const existing = await findActiveSlot(ctx);
  if (!existing) {
    return menuResult(ctx, [
      reply('tokenNoActiveBooking', t(ctx.language, 'tokenNoActiveBooking')),
    ]);
  }

  return menuResult(ctx, [
    reply(
      'slotStatus',
      t(ctx.language, 'slotStatus', {
        doctorName: ctx.doctor.name,
        date: formatDateForPatient(existing.date),
        time: existing.slotStart ? timeLabel(existing.slotStart, ctx.doctor) : '-',
      }),
    ),
  ]);
}

async function askCancelConfirmation(ctx: ConversationContext): Promise<StepResult> {
  const existing = await findActiveSlot(ctx);
  if (!existing) {
    return menuResult(ctx, [
      reply('tokenNoActiveBooking', t(ctx.language, 'tokenNoActiveBooking')),
    ]);
  }

  return {
    nextStep: Steps.SLOT_CONFIRM_CANCEL,
    replies: [
      reply(
        'slotCancelConfirm',
        t(ctx.language, 'slotCancelConfirm', {
          date: formatDateForPatient(existing.date),
          time: existing.slotStart ? timeLabel(existing.slotStart, ctx.doctor) : '-',
        }),
        confirmButtons(ctx.language),
      ),
    ],
    data: { appointmentId: existing.id },
  };
}

async function handleCancelConfirmation(ctx: ConversationContext): Promise<StepResult> {
  if (!isYes(ctx.input)) {
    return menuResult(ctx, [
      reply('tokenCancelAborted', t(ctx.language, 'tokenCancelAborted')),
    ]);
  }

  const appointmentId = ctx.data?.['appointmentId'] as string | undefined;
  if (!appointmentId) return menuResult(ctx);

  const cancelled = await cancelAppointment(appointmentId);

  return {
    nextStep: Steps.SLOT_MENU,
    replies: [
      reply(
        'slotCancelled',
        t(ctx.language, 'slotCancelled', {
          date: formatDateForPatient(cancelled.date),
          time: cancelled.slotStart ? timeLabel(cancelled.slotStart, ctx.doctor) : '-',
        }),
      ),
    ],
    data: {},
    // The slot frees up immediately; the reminders for it must not fire.
    effects: [{ type: 'CANCEL_REMINDERS', appointmentId }],
  };
}

async function findActiveSlot(ctx: ConversationContext) {
  const { prisma } = await import('../../db/prisma');
  return prisma.appointment.findFirst({
    where: {
      doctorId: ctx.doctor.id,
      patientId: ctx.patient.id,
      type: 'SLOT',
      status: { in: ['BOOKED', 'ARRIVED', 'IN_PROGRESS'] },
      date: { gte: ctx.today },
    },
    orderBy: { slotStart: 'asc' },
  });
}

// ---- flow ----

export const slotFlow: ConversationFlow = {
  entryStep: Steps.SLOT_MENU,

  owns(step) {
    return step.startsWith('SLOT_');
  },

  async handle(ctx) {
    switch (ctx.step) {
      case Steps.SLOT_AWAITING_DATE:
        return handleDateChoice(ctx);
      case Steps.SLOT_AWAITING_TIME:
        return handleTimeChoice(ctx);
      case Steps.SLOT_CONFIRM_BOOKING:
        return handleBookingConfirmation(ctx);
      case Steps.SLOT_CONFIRM_CANCEL:
        return handleCancelConfirmation(ctx);

      case Steps.SLOT_MENU:
      default: {
        const choice = numericChoice(ctx.input);
        if (choice === 1) return askForDate(ctx);
        if (choice === 2) return showStatus(ctx);
        if (choice === 3) return askCancelConfirmation(ctx);

        // Anything unrecognised re-shows the menu, which is also the entry path
        // for a fresh conversation (input is blanked by the engine).
        return ctx.input.trim() === ''
          ? menuResult(ctx)
          : menuResult(ctx, [reply('unknownInput', t(ctx.language, 'unknownInput'))]);
      }
    }
  },
};
