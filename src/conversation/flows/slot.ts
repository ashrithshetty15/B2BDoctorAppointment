import type { Doctor, Language } from '@prisma/client';
import { cancelAppointment } from '../../domain/appointments';
import {
  bookSlot,
  getAvailableSlots,
  getNextAvailableDates,
  moveSlot,
  plannedReminders,
  slotLabel,
  type Slot,
} from '../../domain/slots';
import { PERIODS, periodOf, splitByPeriod, type Period } from '../../domain/dayPeriods';
import { t } from '../../i18n/templates';
import { MAX_LIST_ROWS, type ListRow, type ReplyButton } from '../../messaging/types';
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
 * How many days a patient is offered.
 *
 * Counted in days the doctor actually works, not days on the calendar. Those
 * were the same thing until a part-time doctor met it: Kavya works Monday to
 * Friday afternoons, so on a Friday evening a three-*calendar*-day window held
 * her past Friday, Saturday and Sunday — and offered nothing at all, as though
 * she were fully booked. Three working days gives her Monday, Tuesday,
 * Wednesday.
 */
const DATES_OFFERED = 3;

/**
 * How far to search to find those days.
 *
 * Wide enough for a doctor who works two days a week to still have three
 * options, while a full-time doctor never sees beyond the end of the week —
 * the search stops as soon as it has enough. This is a search bound, not a
 * booking horizon: what limits how far ahead anyone books is DATES_OFFERED.
 */
const BOOKING_LOOKAHEAD_DAYS = 14;

/** Dates offered at once. Well inside Meta's ten list rows. */
const DATE_PAGE = DATES_OFFERED;

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

// ---- menu ----

/**
 * The menu, plus a way back to the doctor list where there is one to go back to.
 *
 * The switch keyword is useless if nobody knows it exists, and the menu is the
 * one screen a patient always sees. Shown only at a clinic with more than one
 * doctor — at a solo practice it would promise something that does not exist.
 *
 * Two complete strings joined, not a sentence assembled from fragments: each
 * half is independently translated.
 */
/**
 * WhatsApp allows three reply buttons and no more, so at a clinic with several
 * doctors the third is "Change doctor" and cancelling moves to the typed word.
 *
 * Which is why the hint line exists: the button that left has to be advertised
 * somewhere, or it simply disappears. Cancelling is also named in the booking
 * confirmation and in both reminders, so it is reachable from every message a
 * patient is likely to still have in front of them.
 *
 * A solo clinic has no doctor to change and keeps the Cancel button, so it sees
 * no hint at all.
 */
function menuButtons(ctx: ConversationContext): ReplyButton[] {
  const common: ReplyButton[] = [
    { id: '1', title: t(ctx.language, 'btnBookSlot') },
    { id: '2', title: t(ctx.language, 'btnMyAppointment') },
  ];

  // `doctor` rather than a digit: a tap arrives as the button's id, and that is
  // the same token isDoctorSwitchRequest already recognises when it is typed —
  // so tapping and typing land in one place instead of two.
  return ctx.doctorCount > 1
    ? [...common, { id: 'doctor', title: t(ctx.language, 'btnChangeDoctor') }]
    : [...common, { id: '3', title: t(ctx.language, 'btnCancelSlot') }];
}

function menuText(ctx: ConversationContext): string {
  const menu = t(ctx.language, 'slotMainMenu', { doctorName: ctx.doctor.name });
  return ctx.doctorCount > 1 ? `${menu}\n\n${t(ctx.language, 'slotCancelHint')}` : menu;
}

async function menuResult(ctx: ConversationContext, extraFirst?: Reply[]): Promise<StepResult> {
  return {
    nextStep: Steps.SLOT_MENU,
    replies: [...(extraFirst ?? []), reply('slotMainMenu', menuText(ctx), menuButtons(ctx))],
    data: {},
  };
}

// ---- date picking ----

async function askForDate(ctx: ConversationContext, extraFirst?: Reply[]): Promise<StepResult> {
  const dates = await getNextAvailableDates(
    ctx.doctor,
    ctx.today,
    DATE_PAGE,
    BOOKING_LOOKAHEAD_DAYS,
  );

  if (dates.length === 0) {
    // Nothing free anywhere in the search window — back to the menu rather than
    // a list with nothing in it.
    //
    // Deliberately not "no times are free on <today>": naming today was both
    // wrong and confusing, since today is rarely the reason. It reads as though
    // tomorrow might work, when in fact every day searched was full.
    return menuResult(ctx, [
      reply('slotNothingAvailable', t(ctx.language, 'slotNothingAvailable')),
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

  return askForTime(ctx, offered[choice - 1]!, 0);
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

const PERIOD_HEADING = {
  MORNING: 'btnMorning',
  AFTERNOON: 'btnAfternoon',
  EVENING: 'btnEvening',
} as const;

/**
 * Choose which times to show, grouped under Morning / Afternoon / Evening.
 *
 * Asking which part of the day first was a whole extra tap on every booking,
 * paid by everyone to help the minority of clinics with more times than a list
 * can hold. Sections do the same job inside one message: the patient sees the
 * shape of the day and picks in one go.
 *
 * When everything fits, everything is shown. When it does not, each part of the
 * day gets a share of the rows rather than the first nine chronologically —
 * otherwise a clinic with a morning and an evening session shows nine morning
 * times and hides the evening behind "more", which is the problem the removed
 * step existed to solve.
 */
function pickRows(
  slots: Slot[],
  timezone: string,
  language: Language,
): { shown: Slot[]; rows: ListRow[]; hasMore: boolean } {
  const byPeriod = splitByPeriod(slots, timezone, (s) => s.start);
  const present = PERIODS.filter((p) => byPeriod[p].length > 0);
  const fitsWhole = slots.length <= MAX_LIST_ROWS;
  const budget = fitsWhole ? slots.length : TIME_PAGE;

  // Round-robin so a short period does not waste its share and a long one takes
  // up the slack.
  const taken: Record<Period, Slot[]> = { MORNING: [], AFTERNOON: [], EVENING: [] };
  let placed = 0;
  for (let depth = 0; placed < budget; depth += 1) {
    let progressed = false;
    for (const p of present) {
      if (placed >= budget) break;
      const next = byPeriod[p][depth];
      if (!next) continue;
      taken[p].push(next);
      placed += 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  const shown = PERIODS.flatMap((p) => taken[p]);
  const rows: ListRow[] = [];
  for (const p of PERIODS) {
    for (const slot of taken[p]) {
      rows.push({
        id: String(shown.indexOf(slot) + 1),
        title: slotLabel(slot, timezone),
        section: t(language, PERIOD_HEADING[p]),
      });
    }
  }

  const hasMore = shown.length < slots.length;
  if (hasMore) rows.push({ id: MORE, title: t(language, 'btnMoreTimes') });

  return { shown, rows, hasMore };
}

async function askForTime(
  ctx: ConversationContext,
  dateKey: string,
  offset: number,
  extraFirst?: Reply[],
): Promise<StepResult> {
  const date = parseDateOnly(dateKey);
  if (!date) return menuResult(ctx);

  const everything = await getAvailableSlots(ctx.doctor, date, ctx.receivedAt);
  if (everything.length === 0) return noTimesLeft(ctx, date);

  // Page one is the spread across the day; "more times" then walks the rest in
  // order, for someone who wants a particular time rather than a rough slot.
  const remaining = offset > 0 ? everything.slice(offset) : everything;
  const picked =
    offset > 0
      ? chronologicalPage(remaining, ctx.doctor.timezone, ctx.language)
      : pickRows(everything, ctx.doctor.timezone, ctx.language);

  return {
    nextStep: Steps.SLOT_AWAITING_TIME,
    replies: [
      ...(extraFirst ?? []),
      replyWithList(
        'slotPickTime',
        t(ctx.language, 'slotPickTime', { date: formatDateForPatient(date) }),
        t(ctx.language, 'btnChooseTime'),
        picked.rows,
      ),
    ],
    // Times are stored as instants: re-deriving by index on the next turn would
    // silently shift if a slot were booked in between.
    data: {
      date: dateKey,
      offset,
      times: picked.shown.map((s: Slot) => s.start.toISOString()),
      hasMore: picked.hasMore,
    },
  };
}

/** The "more times" pages: straight down the day, still grouped. */
function chronologicalPage(
  slots: Slot[],
  timezone: string,
  language: Language,
): { shown: Slot[]; rows: ListRow[]; hasMore: boolean } {
  const shown = slots.slice(0, TIME_PAGE);
  const hasMore = slots.length > TIME_PAGE;

  const rows: ListRow[] = shown.map((slot, i) => ({
    id: String(i + 1),
    title: slotLabel(slot, timezone),
    section: t(language, PERIOD_HEADING[periodOf(slot.start, timezone)]),
  }));
  if (hasMore) rows.push({ id: MORE, title: t(language, 'btnMoreTimes') });

  return { shown, rows, hasMore };
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
        // They hold a different time that day. Offer to move it rather than
        // sending them away to cancel and start again — two steps with a gap
        // the slot they just picked can disappear into.
        return askToMove(ctx, result.existing, date, data.slotStart);
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
      reply('slotBooked', confirmationText(ctx, appointment, time)),
    ],
    data: {},
    effects: [{ type: 'SCHEDULE_REMINDERS', appointmentId: appointment.id }],
  };
}

/**
 * The confirmation, promising only the reminders that will actually arrive.
 *
 * Booking at 9:35 for 9:40 used to say "we will remind you the evening before
 * and again 1 hour ahead" — both already past. Worse, the day-before sweep then
 * fired anyway and told a patient their appointment was *tomorrow* minutes
 * after they made it. Same predicate as the sweep, so the promise and the
 * behaviour cannot drift.
 */
function confirmationText(
  ctx: ConversationContext,
  appointment: { date: Date; slotStart: Date | null },
  time: string,
): string {
  const confirmation = t(ctx.language, 'slotBooked', {
    doctorName: ctx.doctor.name,
    clinicName: ctx.clinic.name,
    date: formatDateForPatient(appointment.date),
    time,
  });

  const planned = appointment.slotStart
    ? plannedReminders(appointment.date, appointment.slotStart, ctx.doctor.timezone, ctx.receivedAt)
    : { dayBefore: false, hourBefore: false };

  const lines = [confirmation];
  if (planned.dayBefore && planned.hourBefore) lines.push(t(ctx.language, 'slotRemindBoth'));
  else if (planned.hourBefore) lines.push(t(ctx.language, 'slotRemindHour'));
  lines.push(t(ctx.language, 'slotCancelNote'));

  return lines.join('\n\n');
}

// ---- moving an existing appointment ----

async function askToMove(
  ctx: ConversationContext,
  existing: { id: string; slotStart: Date | null },
  date: Date,
  slotStart: string,
): Promise<StepResult> {
  return {
    nextStep: Steps.SLOT_CONFIRM_MOVE,
    replies: [
      reply(
        'slotMoveConfirm',
        t(ctx.language, 'slotMoveConfirm', {
          doctorName: ctx.doctor.name,
          date: formatDateForPatient(date),
          fromTime: existing.slotStart ? timeLabel(existing.slotStart, ctx.doctor) : '-',
          toTime: timeLabel(new Date(slotStart), ctx.doctor),
        }),
        confirmButtons(ctx.language),
      ),
    ],
    // The appointment by id and the new time as an instant — never positions in
    // a list that gets regenerated on the next turn.
    data: { date: formatDateOnly(date), slotStart, existingId: existing.id },
  };
}

async function handleMoveConfirmation(ctx: ConversationContext): Promise<StepResult> {
  const data = readData(ctx);
  const existingId = ctx.data?.['existingId'] as string | undefined;
  const date = data.date ? parseDateOnly(data.date) : null;

  if (!existingId || !data.slotStart || !date) return menuResult(ctx);

  if (!isYes(ctx.input)) {
    // Anything but yes keeps what they have. Declining a move must never be
    // read as declining the appointment.
    return menuResult(ctx, [
      reply(
        'slotMoveKept',
        t(ctx.language, 'slotMoveKept', {
          date: formatDateForPatient(date),
          time: timeLabel(new Date(data.slotStart), ctx.doctor),
        }),
      ),
    ]);
  }

  const result = await moveSlot(
    ctx.doctor,
    ctx.patient.id,
    existingId,
    date,
    new Date(data.slotStart),
    ctx.receivedAt,
  );

  if (!result.ok) {
    // Nothing was moved and the original is untouched, so re-offer the day.
    // moveSlot takes the new slot before releasing the old one precisely so
    // that this path leaves them still holding their appointment.
    return askForTime(ctx, data.date!, 0, [
      reply('slotTaken', t(ctx.language, 'slotTaken')),
    ]);
  }

  const moved = result.appointment;
  return {
    nextStep: Steps.SLOT_MENU,
    replies: [
      reply(
        'slotMoved',
        t(ctx.language, 'slotMoved', {
          doctorName: ctx.doctor.name,
          clinicName: ctx.clinic.name,
          date: formatDateForPatient(moved.date),
          time: moved.slotStart ? timeLabel(moved.slotStart, ctx.doctor) : '-',
        }),
      ),
    ],
    data: {},
    // Reminders follow the appointment, or the patient is reminded about a time
    // they are no longer coming at.
    effects: [
      { type: 'CANCEL_REMINDERS', appointmentId: existingId },
      { type: 'SCHEDULE_REMINDERS', appointmentId: moved.id },
    ],
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
      case Steps.SLOT_AWAITING_TIME:
        return handleTimeChoice(ctx);
      case Steps.SLOT_CONFIRM_BOOKING:
        return handleBookingConfirmation(ctx);
      case Steps.SLOT_CONFIRM_MOVE:
        return handleMoveConfirmation(ctx);
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
