import { vi } from 'vitest';
import type {
  Appointment,
  Clinic,
  Doctor,
  Language,
  Patient,
  BookingMode,
} from '@prisma/client';

/**
 * A clinic in memory, so a whole conversation can run against the real engine,
 * the real flows and the real copy.
 *
 * WHY THIS EXISTS
 * ---------------
 * The unit tests either mock the flows (engine.test.ts) or mock the engine
 * (flows/*.test.ts). Nothing exercised the seam between them, and both of the
 * loop bugs lived exactly there: the engine decided whether a turn was a
 * "fresh" arrival and blanked the patient's text, while the flow decided what
 * to render. Each was correct on its own terms, and together they produced a
 * menu that repeated forever.
 *
 * The second reason is shape. A solo clinic and a three-doctor clinic take
 * different paths through selectDoctor, and the solo path was the one nobody
 * was driving — Lakeview looked healthy all the way through a bug that made
 * Sunrise unusable. Each shape now has its own journey file.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * Real: engine, every flow, onboarding, the doctor picker, intent parsing,
 * session expiry, all patient-facing copy in both languages, and the slot
 * arithmetic (generateSlots, plannedReminders, slotLabel are imported for
 * real).
 *
 * Faked: persistence only — the three tables the engine touches directly, and
 * the domain functions that read or write appointments. Nothing here decides
 * what a patient sees.
 *
 * Deliberately NOT a real database. The local .env points at the production
 * database, so a test suite that connected to it would be one `beforeEach`
 * away from deleting a live clinic's appointments.
 */

let seq = 0;
const id = (prefix: string) => `${prefix}-${(seq += 1)}`;

export interface WorldConfig {
  clinicName?: string;
  /** One entry per doctor, in the order patients will be offered them. */
  doctors: { name: string; mode?: BookingMode }[];
  defaultLanguage?: Language;
  /** Frozen "now" for the whole journey, so transcripts are stable. */
  now?: Date;
}

interface World {
  clinic: Clinic;
  doctors: Doctor[];
  patients: Patient[];
  appointments: Appointment[];
  sessions: Map<string, Record<string, unknown>>;
  processed: Set<string>;
  /** Everything the engine handed to the outbound queue, in order. */
  sent: { text: string; templateName: string; buttons?: { id: string; title: string }[] }[];
  effects: string[];
  now: Date;
}

// One mutable world per test file, reset between tests. A module-level
// singleton is what lets the vi.mock factories reach it without every mocked
// module needing to be re-wired per test.
export const world: World = {} as World;

/**
 * A morning and an afternoon surgery, six days a week.
 *
 * Two windows rather than one because the time list sorts slots into Morning /
 * Afternoon / Evening sections, and a day with only a morning would never
 * exercise that — which is the whole reason the separate "what time of day?"
 * question was removed.
 */
const SURGERY = [
  { start: '09:00', end: '12:00' },
  { start: '15:00', end: '18:00' },
];

const WORKING_HOURS = {
  mon: SURGERY,
  tue: SURGERY,
  wed: SURGERY,
  thu: SURGERY,
  fri: SURGERY,
  sat: SURGERY,
  sun: [],
};

export function resetWorld(config: WorldConfig): void {
  seq = 0;

  const clinicId = id('clinic');
  world.clinic = {
    id: clinicId,
    name: config.clinicName ?? 'Test Clinic',
    timezone: 'Asia/Kolkata',
    defaultLanguage: config.defaultLanguage ?? 'EN',
    whatsappPhoneNumberId: 'pn-test',
    whatsappNumber: '919000000000',
  } as unknown as Clinic;

  world.doctors = config.doctors.map(
    (d) =>
      ({
        id: id('doctor'),
        name: d.name,
        clinicId,
        clinicName: world.clinic.name,
        bookingMode: d.mode ?? 'TOKEN',
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
        defaultLanguage: world.clinic.defaultLanguage,
        workingHours: WORKING_HOURS,
        leaveDates: [],
        consultDurationMins: 15,
        avgConsultTimeMins: 15,
        consultSampleCount: 0,
        dailyTokenCap: 40,
      }) as unknown as Doctor,
  );

  world.patients = [];
  world.appointments = [];
  world.sessions = new Map();
  world.processed = new Set();
  world.sent = [];
  world.effects = [];
  world.now = config.now ?? new Date('2026-09-21T03:30:00Z'); // Mon 09:00 IST

  // The engine works out "today" from the clock itself, so a journey that did
  // not freeze it would assert on whatever date the suite happened to run —
  // green on a Monday and red on a Saturday. Only Date is faked: faking timers
  // as well would stall the flows' own awaits.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(world.now);
}

const sameDay = (a: Date, b: Date) =>
  a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/** Whole-day leave. Lives in tokenQueue rather than slots, despite the name. */
const onLeave = (doctor: Pick<Doctor, 'leaveDates'>, date: Date) =>
  doctor.leaveDates.some((d) => sameDay(d, date));

const ACTIVE = ['BOOKED', 'ARRIVED', 'IN_PROGRESS'];

function addAppointment(fields: Partial<Appointment>): Appointment {
  const appointment = {
    id: id('appt'),
    status: 'BOOKED',
    tokenNumber: null,
    slotStart: null,
    slotEnd: null,
    cancelledAt: null,
    source: 'WHATSAPP',
    ...fields,
  } as unknown as Appointment;
  world.appointments.push(appointment);
  return appointment;
}

// ---------------------------------------------------------------------------
// Module fakes. Each is passed straight to vi.mock in a journey file.
// ---------------------------------------------------------------------------

/** The three tables the engine and session layer touch directly. */
export function prismaModule() {
  return {
    prisma: {
      conversationSession: {
        findUnique: async ({ where }: { where: { phone_clinic: { phone: string } } }) =>
          world.sessions.get(where.phone_clinic.phone) ?? null,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { phone_clinic: { phone: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const phone = where.phone_clinic.phone;
          const existing = world.sessions.get(phone);
          const row = existing ? { ...existing, ...update } : { ...create };
          world.sessions.set(phone, row);
          return row;
        },
      },
      processedMessage: {
        findUnique: async ({ where }: { where: { providerMessageId: string } }) =>
          world.processed.has(where.providerMessageId)
            ? { providerMessageId: where.providerMessageId }
            : null,
        create: async ({ data }: { data: { providerMessageId: string } }) => {
          world.processed.add(data.providerMessageId);
          return data;
        },
      },
      messagingWindow: { upsert: async () => ({}) },
      /**
       * slot.ts reaches past the domain layer for the appointment a patient
       * currently holds (findActiveSlot), so the journeys need this one query
       * shape. Narrow on purpose: it answers the query the flow actually makes
       * rather than pretending to be Prisma.
       */
      appointment: {
        findFirst: async ({
          where,
        }: {
          where: {
            doctorId: string;
            patientId: string;
            type: string;
            status: { in: string[] };
            date?: { gte: Date };
          };
        }) =>
          world.appointments
            .filter(
              (a) =>
                a.doctorId === where.doctorId &&
                a.patientId === where.patientId &&
                a.type === where.type &&
                where.status.in.includes(a.status) &&
                (!where.date?.gte || a.date.getTime() >= where.date.gte.getTime()),
            )
            .sort((a, b) => (a.slotStart?.getTime() ?? 0) - (b.slotStart?.getTime() ?? 0))[0] ??
          null,
      },
    },
  };
}

export function clinicsModule() {
  return {
    resolveClinicForChannel: async () => ({
      clinic: world.clinic,
      doctors: world.doctors.filter((d) => d.status === 'ACTIVE'),
    }),
    outboundChannelForClinic: () => 'pn-test',
    activeDoctors: async () => world.doctors.filter((d) => d.status === 'ACTIVE'),
  };
}

export function patientsModule() {
  return {
    findOrCreatePatient: async (phone: string) => {
      const existing = world.patients.find((p) => p.phone === phone);
      if (existing) return existing;
      const patient = {
        id: id('patient'),
        phone,
        name: null,
        language: world.clinic.defaultLanguage,
      } as unknown as Patient;
      world.patients.push(patient);
      return patient;
    },
    // Name validation is real logic a patient hits, so it is not faked.
    isPlausibleName: (name: string) => name.trim().length >= 2 && !/^\d+$/.test(name.trim()),
    setPatientName: async (patientId: string, name: string) => {
      const p = world.patients.find((x) => x.id === patientId);
      if (p) p.name = name;
    },
    setPatientLanguage: async (patientId: string, language: Language) => {
      const p = world.patients.find((x) => x.id === patientId);
      if (p) p.language = language;
    },
  };
}

export function queuesModule() {
  return {
    enqueueOutboundBulk: async (
      messages: { text: string; templateName: string; buttons?: { id: string; title: string }[] }[],
    ) => {
      world.sent.push(...messages);
    },
    enqueueTokenQueueRecalc: async () => {
      world.effects.push('RECALC_TOKEN_QUEUE');
    },
    cancelReminders: async () => {
      world.effects.push('CANCEL_REMINDERS');
    },
    enqueueReminders: async () => {
      world.effects.push('SCHEDULE_REMINDERS');
    },
  };
}

/**
 * Slot booking against the in-memory list.
 *
 * The scheduling arithmetic is imported for real — which slots exist on a day,
 * which reminders are still worth sending, how a time is labelled — because
 * that is logic a patient can see the results of. Only the reads and writes
 * are local.
 */
export async function slotsModule() {
  const actual = await import('../../domain/slots');

  const bookedStarts = (doctorId: string, date: Date) =>
    new Set(
      world.appointments
        .filter(
          (a) =>
            a.doctorId === doctorId &&
            a.type === 'SLOT' &&
            sameDay(a.date, date) &&
            ACTIVE.includes(a.status) &&
            a.slotStart,
        )
        .map((a) => a.slotStart!.getTime()),
    );

  const getAvailableSlots = async (doctor: Doctor, date: Date, now: Date = world.now) => {
    const taken = bookedStarts(doctor.id, date);
    return actual
      .generateSlots(doctor, date)
      .filter((s) => !taken.has(s.start.getTime()) && s.start.getTime() > now.getTime());
  };

  const book = (doctor: Doctor, patientId: string, date: Date, slotStart: Date) => {
    const slot = actual
      .generateSlots(doctor, date)
      .find((s) => s.start.getTime() === slotStart.getTime());
    if (!slot) return { ok: false as const, reason: 'NOT_A_SLOT' as const };
    if (slot.start.getTime() <= world.now.getTime())
      return { ok: false as const, reason: 'IN_PAST' as const };
    if (bookedStarts(doctor.id, date).has(slotStart.getTime()))
      return { ok: false as const, reason: 'TAKEN' as const };
    return {
      ok: true as const,
      appointment: addAppointment({
        doctorId: doctor.id,
        patientId,
        date,
        type: 'SLOT',
        slotStart: slot.start,
        slotEnd: slot.end,
      }),
    };
  };

  return {
    ...actual,
    getAvailableSlots,
    getNextAvailableDates: async (doctor: Doctor, from: Date, count = 5, lookAhead = 21) => {
      const out: Date[] = [];
      for (let i = 0; i < lookAhead && out.length < count; i += 1) {
        const date = new Date(from.getTime() + i * 86_400_000);
        if ((await getAvailableSlots(doctor, date)).length) out.push(date);
      }
      return out;
    },
    bookSlot: async (doctor: Doctor, patientId: string, date: Date, slotStart: Date) => {
      if (onLeave(doctor, date)) return { ok: false, reason: 'ON_LEAVE' };

      // The real rule: one appointment per patient per day. Asking for a
      // different time returns the one they hold so the flow can offer a move.
      const held = world.appointments.find(
        (a) =>
          a.doctorId === doctor.id &&
          a.patientId === patientId &&
          a.type === 'SLOT' &&
          sameDay(a.date, date) &&
          ACTIVE.includes(a.status),
      );
      if (held) {
        return held.slotStart?.getTime() === slotStart.getTime()
          ? { ok: true, appointment: held, alreadyExisted: true }
          : { ok: false, reason: 'PATIENT_HAS_SLOT', existing: held };
      }

      return book(doctor, patientId, date, slotStart);
    },
    moveSlot: async (
      doctor: Doctor,
      patientId: string,
      existingId: string,
      date: Date,
      slotStart: Date,
    ) => {
      const result = book(doctor, patientId, date, slotStart);
      // New slot first, old one second — the ordering the real transaction
      // guarantees, so a failed move still leaves them holding something.
      if (result.ok) {
        const old = world.appointments.find((a) => a.id === existingId);
        if (old) {
          old.status = 'CANCELLED' as Appointment['status'];
          old.cancelledAt = world.now;
        }
      }
      return result;
    },
  };
}

export async function tokenQueueModule() {
  const actual = await import('../../domain/tokenQueue');

  const activeTokens = (doctorId: string, date: Date) =>
    world.appointments.filter(
      (a) =>
        a.doctorId === doctorId &&
        a.type === 'TOKEN' &&
        sameDay(a.date, date) &&
        ACTIVE.includes(a.status),
    );

  const findActiveToken = async (doctorId: string, patientId: string, date: Date) =>
    activeTokens(doctorId, date).find((a) => a.patientId === patientId) ?? null;

  return {
    ...actual,
    findActiveToken,
    getActiveTokens: async (doctorId: string, date: Date) => activeTokens(doctorId, date),
    getOrCreateQueueState: async () => ({ nowServingToken: null, delayMins: 0 }),
    issueToken: async (doctor: Doctor, patientId: string, date: Date) => {
      if (actual.isOnLeave(doctor, date)) return { ok: false, reason: 'ON_LEAVE' };

      const existing = await findActiveToken(doctor.id, patientId, date);
      if (existing) return { ok: true, appointment: existing, alreadyExisted: true };

      const issued = activeTokens(doctor.id, date).length;
      if (issued >= doctor.dailyTokenCap) return { ok: false, reason: 'CAP_REACHED' };

      return {
        ok: true,
        alreadyExisted: false,
        appointment: addAppointment({
          doctorId: doctor.id,
          patientId,
          date,
          type: 'TOKEN',
          tokenNumber: issued + 1,
        }),
      };
    },
    computePosition: async (appointment: Appointment, doctor: Doctor) => {
      const tokenNumber = appointment.tokenNumber ?? 0;
      const ahead = activeTokens(doctor.id, appointment.date).filter(
        (a) => (a.tokenNumber ?? 0) < tokenNumber && a.id !== appointment.id,
      ).length;
      return {
        tokenNumber,
        ahead,
        etaMins: Math.round(ahead * doctor.avgConsultTimeMins),
        nowServingToken: null,
      };
    },
  };
}

/**
 * Follow-ups, minus the database.
 *
 * `doctorForFollowUpTap` is the security boundary — the payload arrives as
 * patient-typed text — so it is reimplemented here rather than stubbed to
 * true, and the journeys can drive a tap with somebody else's id.
 */
export async function followUpModule() {
  const actual = await import('../../domain/followUp');
  return {
    ...actual,
    doctorForFollowUpTap: async (
      appointmentId: string,
      patientId: string,
      doctors: { id: string }[],
    ) => {
      const appointment = world.appointments.find(
        (a) => a.id === appointmentId && a.patientId === patientId,
      );
      if (!appointment) return null;
      return doctors.some((d) => d.id === appointment.doctorId) ? appointment.doctorId : null;
    },
    // Stamped once: tapping the same reminder twice is one person answering
    // one reminder, and counting it twice would inflate the conversion figure.
    markFollowUpTapped: async (appointmentId: string, at: Date) => {
      const appointment = world.appointments.find((a) => a.id === appointmentId);
      if (appointment && !appointment.followUpTappedAt) appointment.followUpTappedAt = at;
    },
  };
}

export function appointmentsModule() {
  return {
    cancelAppointment: async (appointmentId: string) => {
      const appointment = world.appointments.find((a) => a.id === appointmentId);
      if (!appointment) throw new Error(`No appointment ${appointmentId}`);
      appointment.status = 'CANCELLED' as Appointment['status'];
      appointment.cancelledAt = world.now;
      return appointment;
    },
  };
}

export function loggerModule() {
  const noop = () => undefined;
  return {
    logger: {
      info: noop,
      warn: noop,
      debug: noop,
      // Never silenced. The engine catches everything a flow throws and
      // apologises to the patient, so a swallowed error would otherwise reach
      // a journey as a mystery: an assertion failing against "Sorry, something
      // went wrong on our side" with no clue what went wrong.
      error: (...args: unknown[]) => console.error('[flow error]', ...args),
    },
  };
}
