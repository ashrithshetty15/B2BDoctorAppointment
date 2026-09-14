import type { AppointmentStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { clinicToday } from '../utils/time';

/**
 * Read-only aggregations for the doctor's reports page.
 *
 * Everything here is derived from existing columns — no snapshot tables exist.
 * Two limits are inherent to the schema rather than to this code, and both are
 * surfaced in the UI rather than hidden:
 *
 *  - `Appointment.consultMins` is only written when the doctor moved the
 *    appointment through IN_PROGRESS before DONE. Averaging it silently
 *    surveys that subset, so `consultCoverage` reports how much of the period
 *    it actually covers.
 *  - A day with no activity has no QueueState row at all, so per-day series are
 *    filled against a generated date range instead of being read straight out.
 */

export interface DayCount {
  date: string;
  booked: number;
  arrived: number;
  inProgress: number;
  done: number;
  noShow: number;
  cancelled: number;
  total: number;
}

export interface ReportSummary {
  from: string;
  to: string;
  days: number;

  totals: {
    total: number;
    completed: number;
    noShow: number;
    cancelled: number;
    stillOpen: number;
  };
  /** Completed / (completed + noShow). Null when neither has occurred. */
  attendanceRate: number | null;
  noShowRate: number | null;

  consult: {
    /** Mean of recorded consultMins, or null when none were recorded. */
    avgMins: number | null;
    medianMins: number | null;
    /** Recorded / completed — how much of the period the average speaks for. */
    coverage: number | null;
    recorded: number;
    completed: number;
    /** Consults recorded at the 120-minute ceiling; likely forgotten "Done" taps. */
    atCeiling: number;
  };

  wait: {
    /** arrivedAt -> startedAt, the wait the patient actually experienced. */
    avgMins: number | null;
    maxMins: number | null;
    sampled: number;
  };

  perDay: DayCount[];
  /** Announced delay per day — the one genuine historical series in the schema. */
  delaysByDay: { date: string; delayMins: number; tokensIssued: number }[];
  /** Consults started per hour of day, in the doctor's timezone. */
  busiestHours: { hour: number; count: number }[];

  patients: { unique: number; returning: number };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] as number) + (s[mid] as number)) / 2 : (s[mid] as number);
}

/** Hour of day in an IANA timezone, without pulling a formatter per row. */
function hourInZone(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  return hour ? Number(hour) % 24 : 0;
}

export async function buildReport(
  doctor: { id: string; timezone: string },
  days: number,
): Promise<ReportSummary> {
  const to = clinicToday(doctor.timezone);
  const from = addDays(to, -(days - 1));

  const [appointments, queueStates] = await Promise.all([
    prisma.appointment.findMany({
      where: { doctorId: doctor.id, date: { gte: from, lte: to } },
      select: {
        patientId: true,
        date: true,
        status: true,
        consultMins: true,
        arrivedAt: true,
        startedAt: true,
      },
    }),
    prisma.queueState.findMany({
      where: { doctorId: doctor.id, date: { gte: from, lte: to } },
      select: { date: true, delayMins: true, lastIssuedToken: true },
    }),
  ]);

  const counts = new Map<string, DayCount>();
  for (let i = 0; i < days; i += 1) {
    const key = isoDate(addDays(from, i));
    // Seeded for every day in range: a day with no appointments must read as
    // zero rather than vanish from the series.
    counts.set(key, {
      date: key,
      booked: 0,
      arrived: 0,
      inProgress: 0,
      done: 0,
      noShow: 0,
      cancelled: 0,
      total: 0,
    });
  }

  const bucket: Record<AppointmentStatus, keyof Omit<DayCount, 'date' | 'total'>> = {
    BOOKED: 'booked',
    ARRIVED: 'arrived',
    IN_PROGRESS: 'inProgress',
    DONE: 'done',
    NO_SHOW: 'noShow',
    CANCELLED: 'cancelled',
  };

  const consultMins: number[] = [];
  const waits: number[] = [];
  const hours = new Map<number, number>();
  const perPatient = new Map<string, number>();
  let completed = 0;
  let atCeiling = 0;

  for (const a of appointments) {
    const day = counts.get(isoDate(a.date));
    if (day) {
      day[bucket[a.status]] += 1;
      day.total += 1;
    }

    perPatient.set(a.patientId, (perPatient.get(a.patientId) ?? 0) + 1);

    if (a.status === 'DONE') {
      completed += 1;
      if (a.consultMins !== null) {
        consultMins.push(a.consultMins);
        // The writer clamps to [1,120]; a value sitting exactly on the ceiling
        // is far more likely a forgotten "Done" than a real two-hour consult.
        if (a.consultMins >= 120) atCeiling += 1;
      }
    }

    if (a.arrivedAt && a.startedAt) {
      const mins = (a.startedAt.getTime() - a.arrivedAt.getTime()) / 60_000;
      if (mins >= 0) waits.push(mins);
    }

    if (a.startedAt) {
      const h = hourInZone(a.startedAt, doctor.timezone);
      hours.set(h, (hours.get(h) ?? 0) + 1);
    }
  }

  const totals = {
    total: appointments.length,
    completed,
    noShow: appointments.filter((a) => a.status === 'NO_SHOW').length,
    cancelled: appointments.filter((a) => a.status === 'CANCELLED').length,
    stillOpen: appointments.filter(
      (a) => a.status === 'BOOKED' || a.status === 'ARRIVED' || a.status === 'IN_PROGRESS',
    ).length,
  };

  const attended = totals.completed + totals.noShow;

  const avgWait = mean(waits);
  const avgConsult = mean(consultMins);
  const medConsult = median(consultMins);

  return {
    from: isoDate(from),
    to: isoDate(to),
    days,
    totals,
    attendanceRate: attended > 0 ? totals.completed / attended : null,
    noShowRate: attended > 0 ? totals.noShow / attended : null,
    consult: {
      avgMins: avgConsult === null ? null : Math.round(avgConsult * 10) / 10,
      medianMins: medConsult,
      coverage: completed > 0 ? consultMins.length / completed : null,
      recorded: consultMins.length,
      completed,
      atCeiling,
    },
    wait: {
      avgMins: avgWait === null ? null : Math.round(avgWait),
      maxMins: waits.length > 0 ? Math.round(Math.max(...waits)) : null,
      sampled: waits.length,
    },
    perDay: [...counts.values()],
    delaysByDay: queueStates
      .map((q) => ({
        date: isoDate(q.date),
        delayMins: q.delayMins,
        tokensIssued: q.lastIssuedToken,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    busiestHours: [...hours.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour),
    patients: {
      unique: perPatient.size,
      returning: [...perPatient.values()].filter((n) => n > 1).length,
    },
  };
}

export interface PatientRow {
  patientId: string;
  name: string | null;
  phone: string;
  language: string;
  visits: number;
  /** Last visit WITH THIS DOCTOR. Patient.lastVisitAt is global, so unusable here. */
  lastVisit: Date | null;
}

export async function listPatientsForDoctor(doctorId: string): Promise<PatientRow[]> {
  const grouped = await prisma.appointment.groupBy({
    by: ['patientId'],
    where: { doctorId, status: { not: 'CANCELLED' } },
    _count: { _all: true },
    _max: { date: true },
  });

  if (grouped.length === 0) return [];

  const patients = await prisma.patient.findMany({
    where: { id: { in: grouped.map((g) => g.patientId) } },
    select: { id: true, name: true, phone: true, language: true },
  });
  const byId = new Map(patients.map((p) => [p.id, p]));

  return grouped
    .map((g) => {
      const p = byId.get(g.patientId);
      return {
        patientId: g.patientId,
        name: p?.name ?? null,
        phone: p?.phone ?? '',
        language: p?.language ?? 'EN',
        visits: g._count._all,
        lastVisit: g._max.date,
      };
    })
    .sort((a, b) => (b.lastVisit?.getTime() ?? 0) - (a.lastVisit?.getTime() ?? 0));
}

/**
 * Most recent visits first, capped: a patient who has been coming for years
 * would otherwise render every appointment they ever had in one page.
 */
export const PATIENT_HISTORY_LIMIT = 50;

export async function patientHistory(doctorId: string, patientId: string) {
  const [patient, appointments, totalVisits] = await Promise.all([
    prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, name: true, phone: true, language: true, createdAt: true },
    }),
    prisma.appointment.findMany({
      where: { doctorId, patientId },
      orderBy: [{ date: 'desc' }, { tokenNumber: 'desc' }],
      take: PATIENT_HISTORY_LIMIT,
      select: {
        id: true,
        date: true,
        type: true,
        status: true,
        tokenNumber: true,
        slotStart: true,
        arrivedAt: true,
        startedAt: true,
        completedAt: true,
        consultMins: true,
        // The remark the desk or the doctor wrote on the queue. Without this the
        // patient page — the one place anyone goes looking for it later — showed
        // nothing at all.
        notes: true,
        documents: {
          orderBy: { createdAt: 'asc' },
          // inlineData is deliberately absent: on the db driver it is the whole
          // file, and this query loads up to 50 visits' worth of rows.
          select: {
            id: true,
            filename: true,
            contentType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.appointment.count({ where: { doctorId, patientId } }),
  ]);

  return { patient, appointments, totalVisits };
}
