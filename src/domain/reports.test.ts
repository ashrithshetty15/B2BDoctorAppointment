import { describe, expect, it, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
const queueFindMany = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    appointment: { findMany: (...a: unknown[]) => findMany(...a) },
    queueState: { findMany: (...a: unknown[]) => queueFindMany(...a) },
  },
}));

// vi.mock is hoisted above this import, so the mocked prisma is in place.
import { buildReport } from './reports';

const DOCTOR = { id: 'doc-1', timezone: 'Asia/Kolkata' };

function appt(over: Record<string, unknown> = {}) {
  return {
    patientId: 'p1',
    date: new Date('2026-09-13T00:00:00Z'),
    status: 'DONE',
    consultMins: 10,
    arrivedAt: null,
    startedAt: null,
    ...over,
  };
}

beforeEach(() => {
  findMany.mockReset();
  queueFindMany.mockReset();
  queueFindMany.mockResolvedValue([]);
});

describe('buildReport', () => {
  it('fills every day in range so a quiet day reads as zero, not a gap', async () => {
    findMany.mockResolvedValue([]);

    const r = await buildReport(DOCTOR, 7);

    expect(r.perDay).toHaveLength(7);
    expect(r.perDay.every((d) => d.total === 0)).toBe(true);
    // A QueueState row only exists for days with activity, so an empty result
    // must not collapse the series.
    const dates = r.perDay.map((d) => d.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('counts by status and derives the no-show rate from settled visits only', async () => {
    findMany.mockResolvedValue([
      appt({ status: 'DONE' }),
      appt({ status: 'DONE' }),
      appt({ status: 'DONE' }),
      appt({ status: 'NO_SHOW', consultMins: null }),
      appt({ status: 'CANCELLED', consultMins: null }),
      appt({ status: 'BOOKED', consultMins: null }),
    ]);

    const r = await buildReport(DOCTOR, 7);

    expect(r.totals.completed).toBe(3);
    expect(r.totals.noShow).toBe(1);
    expect(r.totals.cancelled).toBe(1);
    expect(r.totals.stillOpen).toBe(1);
    // Cancelled and still-open are excluded: 3 of 4 settled visits attended.
    expect(r.noShowRate).toBeCloseTo(0.25);
    expect(r.attendanceRate).toBeCloseTo(0.75);
  });

  it('reports consult coverage, because consultMins is null when Done skipped in-progress', async () => {
    findMany.mockResolvedValue([
      appt({ consultMins: 10 }),
      appt({ consultMins: 20 }),
      appt({ consultMins: null }),
      appt({ consultMins: null }),
    ]);

    const r = await buildReport(DOCTOR, 7);

    expect(r.consult.completed).toBe(4);
    expect(r.consult.recorded).toBe(2);
    expect(r.consult.coverage).toBeCloseTo(0.5);
    // The average speaks only for the recorded half — 15, not 7.5.
    expect(r.consult.avgMins).toBe(15);
  });

  it('flags consults sitting on the 120-minute clamp as suspect', async () => {
    findMany.mockResolvedValue([
      appt({ consultMins: 120 }),
      appt({ consultMins: 120 }),
      appt({ consultMins: 12 }),
    ]);

    const r = await buildReport(DOCTOR, 7);

    expect(r.consult.atCeiling).toBe(2);
  });

  it('measures the wait the patient actually experienced', async () => {
    findMany.mockResolvedValue([
      appt({
        arrivedAt: new Date('2026-09-13T04:00:00Z'),
        startedAt: new Date('2026-09-13T04:30:00Z'),
      }),
      appt({
        arrivedAt: new Date('2026-09-13T05:00:00Z'),
        startedAt: new Date('2026-09-13T05:10:00Z'),
      }),
      // No arrivedAt: cannot contribute a wait, and must not count as zero.
      appt({ arrivedAt: null, startedAt: new Date('2026-09-13T06:00:00Z') }),
    ]);

    const r = await buildReport(DOCTOR, 7);

    expect(r.wait.sampled).toBe(2);
    expect(r.wait.avgMins).toBe(20);
    expect(r.wait.maxMins).toBe(30);
  });

  it('separates unique from returning patients', async () => {
    findMany.mockResolvedValue([
      appt({ patientId: 'a' }),
      appt({ patientId: 'a' }),
      appt({ patientId: 'b' }),
      appt({ patientId: 'c' }),
    ]);

    const r = await buildReport(DOCTOR, 7);

    expect(r.patients.unique).toBe(3);
    expect(r.patients.returning).toBe(1);
  });

  it('returns null rather than 0 when there is nothing to average', async () => {
    findMany.mockResolvedValue([]);

    const r = await buildReport(DOCTOR, 7);

    // Null renders as an em dash; 0 would read as a real measurement.
    expect(r.consult.avgMins).toBeNull();
    expect(r.wait.avgMins).toBeNull();
    expect(r.noShowRate).toBeNull();
    expect(r.consult.coverage).toBeNull();
  });
});
