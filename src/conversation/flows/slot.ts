import type { Doctor, Language } from '@prisma/client';
import { cancelAppointment } from '../../domain/appointments';
import {
  bookSlot,
  getAvailableSlots,
  getNextAvailableDates,
  slotLabel,
  type Slot,
} from '../../domain/slots';
import { availablePeriods, splitByPeriod, type Period } from '../../domain/dayPeriods';
import { t } from '../../i18n/templates';
import type { ListRow, ReplyButton } from '../../messaging/types';
import { formatDateForPatient, formatDateOnly, parseDateOnly } from '../../utils/time';
import { isNo, isRestart, isYes, menuIntent, numericChoice } from '../intent';
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

/**
 * How far ahead a patient may book.
 *
 * Deliberately short. A clinic's own plans change inside a week — a conference,
 * a locum, a session moved — and every booking beyond that horizon is one the
 * desk is likely to have to move by hand. Three days also keeps the date list
 * to a glance rather than a scroll.
 */
const BOOKING_HORIZON_DAYS = 3;

/** Dates offered at once. Capped by the horizon above, not by Meta's ten rows. */
const DATE_PAGE = BOOKING_HORIZON_DAYS;

/**
 * Times per page. Nine leaves the tenth row for "more times" — a clinic running
 * 10-minute consults over a morning has more than twenty slots, and a list
 * cannot hold them.
 *
 * Since times are asked for one part of the day at a time, paging is now the
 * exception rather than the rule.
 */
const TIME_PAGE = 9;

const MORE = 'more';

interface SlotData {
  /** YYYY-MM-DD. Stored as a date, never an index into a regenerated list. */
  date?: string;
  /** Which part of the day is being shown, if the patient was asked. */
  period?: Period;
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

const PERIOD_BUTTON = {
  MORNING: 'btnMorning',
  AFTERNOON: 'btnAfternoon',
  EVENING: 'btnEvening',
} as const;

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
  // Horizon passed as the look-ahead too: without it the search would happily
  // return a date three weeks out to fill the list.
  const dates = await getNextAvailableDates(
    ctx.doctor,
    ctx.today,
    DATE_PAGE,
    BOOKING_HORIZON_DAYS,
  );

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
      replyWithList('slotPickDate', t(ctx.language, 'slotPickDate'), t(ctx.language, 'btnChooseDate'), rows),
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

  return askForPeriod(ctx, offered[choice - 1]!);
}

// ---- period picking ----

/**
 * Ask which part of the day, before showing times.
 *
 * A clinic with a morning and an evening session produces more free times than
 * a WhatsApp list can hold, so wanting 6 PM meant paging past every morning
 * slot to find it. Three buttons is exactly what WhatsApp allows, and it turns
 * that into one tap.
 *
 * Skipped entirely when only one part of the day has anything free — asking a
 * question with one possible answer is worse than not asking.
 */
async function askForPeriod(
  ctx: ConversationContext,
  dateKey: string,
  extraFirst?: Reply[],
): Promise<StepResult> {
  const date = parseDateOnly(dateKey);
  if (!date) return menuResult(ctx);

  const all = await getAvailableSlots(ctx.doctor, date, ctx.receivedAt);
  if (all.length === 0) return noTimesLeft(ctx, date);

  const periods = availablePeriods(all, ctx.doctor.timezone, (s) => s.start);
  if (periods.length <= 1) {
    return askForTime(ctx, dateKey, periods[0], 0, extraFirst);
  }

  return {
    nextStep: Steps.SLOT_AWAITING_PERIOD,
    replies: [
      ...(extraFirst ?? []),
      reply(
        'slotPickPeriod',
        t(ctx.language, 'slotPickPeriod', { date: formatDateForPatient(date) }),
        periods.map((p, i) => ({ id: String(i + 1), title: t(ctx.language, PERIOD_BUTTON[p]) })),
      ),
    ],
    // Store which periods were offered, so the reply maps back to the same one
    // even if availability shifts before the patient answers.
    data: { date: dateKey, periods },
  };
}

async function handlePeriodChoice(ctx: ConversationContext): Promise<StepResult> {
  const data = readData(ctx);
  const offered = (ctx.data?.['periods'] as Period[] | undefined) ?? [];
  if (!data.date) return menuResult(ctx);

  const choice = numericChoice(ctx.input);
  if (choice === null || choice < 1 || choice > offered.length) {
    return {
      nextStep: Steps.SLOT_AWAITING_PERIOD,
      replies: [reply('slotInvalidChoice', t(ctx.language, 'slotInvalidChoice'))],
      data: ctx.data,
    };
  }

  return askForTime(ctx, data.date, offered[choice - 1]!, 0);
}

// ---- time picking ----

/** Everything went while they were deciding. Back to the dates. */
async function noTimesLeft(ctx: ConversationContext, date: Date): Promise<StepResult> {
  return askForDate(ctx, [
    reply(
      'slotNoneAvailable',
      t(ctx.language, 'slotNoneAvailable', { date: formatDateForPatient(date) }),
    ),
  ]);
}

async function askForTime(
  ctx: ConversationContext,
  dateKey: string,
  period: Period | undefined,
  offset: number,
  extraFirst?: Reply[],
): Promise<StepResult> {
  const date = parseDateOnly(dateKey);
  if (!date) return menuResult(ctx);

  const everything = await getAvailableSlots(ctx.doctor, date, ctx.receivedAt);
  if (everything.length === 0) return noTimesLeft(ctx, date);

  // Narrow to the chosen part of the day. If that part emptied while they were
  // choosing, fall back to the whole day rather than showing an empty list.
  const inPeriod = period
    ? splitByPeriod(everything, ctx.doctor.timezone, (s) => s.start)[period]
    : everything;
  const all = inPeriod.length > 0 ? inPeriod : everything;

  const page = all.slice(offset, offset + TIME_PAGE);
  const hasMore = all.length > offset + TIME_PAGE;
  const labels = page.map((s) => slotLabel(s, ctx.doctor.timezone));

  const rows: ListRow[] = page.map((_, i) => ({
    id: String(i + 1),
    title: labels[i]!,
  }));
  if (hasMore) rows.push({ id: MORE, title: t(ctx.language, 'btnMoreTimes') });

  const body = t(ctx.language, 'slotPickTime', { date: formatDateForPatient(date) });

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
      ...(period ? { period } : {}),
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
    return askForTime(ctx, data.date, data.period, (data.offset ?? 0) + TIME_PAGE);
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
        return askForTime(ctx, data.date, data.period, 0, [
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
        return askForTime(ctx, data.date, data.period, 0, [
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
    // "hi", "menu", "ನಮಸ್ಕಾರ" — a greeting is a request to start over, at any
    // step, and answering it with "I did not understand that" is both wrong and
    // the single most common thing a patient sees. Checked before the switch so
    // it works mid-booking, not only at the menu.
    if (isRestart(ctx.input)) return menuResult(ctx);

    switch (ctx.step) {
      case Steps.SLOT_AWAITING_DATE:
        return handleDateChoice(ctx);
      case Steps.SLOT_AWAITING_PERIOD:
        return handlePeriodChoice(ctx);
      case Steps.SLOT_AWAITING_TIME:
        return handleTimeChoice(ctx);
      case Steps.SLOT_CONFIRM_BOOKING:
        return handleBookingConfirmation(ctx);
      case Steps.SLOT_CONFIRM_CANCEL:
        return handleCancelConfirmation(ctx);

      case Steps.SLOT_MENU:
      default: {
        // menuIntent rather than a bare number, so "book", "cancel" and their
        // Kannada equivalents work as well as 1/2/3 — the numbers are no longer
        // printed in the message, so typing a word is the natural fallback.
        switch (menuIntent(ctx.input)) {
          case 'BOOK':
            return askForDate(ctx);
          case 'STATUS':
            return showStatus(ctx);
          case 'CANCEL':
            return askCancelConfirmation(ctx);
          default:
            // Anything unrecognised re-shows the menu, which is also the entry
            // path for a fresh conversation (input is blanked by the engine).
            return ctx.input.trim() === ''
              ? menuResult(ctx)
              : menuResult(ctx, [reply('unknownInput', t(ctx.language, 'unknownInput'))]);
        }
      }
    }
  },
};
