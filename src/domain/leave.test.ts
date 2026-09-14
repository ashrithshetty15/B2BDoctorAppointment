import { describe, expect, it } from 'vitest';
import type { Doctor } from '@prisma/client';
import { upcomingLeave } from './leave';

describe('upcomingLeave', () => {
  const today = new Date(Date.UTC(2026, 8, 14));
  const doctorWith = (dates: Date[]) => ({ leaveDates: dates }) as Doctor;

  it('drops past days and keeps today', () => {
    const out = upcomingLeave(
      doctorWith([
        new Date(Date.UTC(2026, 8, 1)),
        new Date(Date.UTC(2026, 8, 14)),
        new Date(Date.UTC(2026, 8, 20)),
      ]),
      today,
    );
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-09-14', '2026-09-20']);
  });

  it('sorts soonest first regardless of stored order', () => {
    const out = upcomingLeave(
      doctorWith([new Date(Date.UTC(2026, 11, 25)), new Date(Date.UTC(2026, 8, 20))]),
      today,
    );
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-09-20', '2026-12-25']);
  });

  it('returns nothing when no days are closed', () => {
    expect(upcomingLeave(doctorWith([]), today)).toEqual([]);
  });
});
