import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const findFirst = vi.fn();
const updateMany = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    appointment: {
      findMany: (...a: unknown[]) => findMany(...a),
      findFirst: (...a: unknown[]) => findFirst(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
  },
}));

import {
  doctorForFollowUpTap,
  followUpFunnel,
  followUpPayload,
  markFollowUpTapped,
  parseFollowUpPayload,
} from './followUp';

/**
 * The conversion figure, and the tap it is built on.
 *
 * This is the number a clinic is shown as revenue and asked to pay against, so
 * the way it can be wrong matters more than usual. It should under-claim: a
 * doctor who checks it against their own day must find it modest, never
 * flattering.
 */

const SINCE = new Date('2026-06-22T00:00:00Z');
const TAP = new Date('2026-09-20T05:00:00Z');

/** First call is the sent reminders; second is the candidate bookings. */
function whenPrismaReturns(sent: unknown[], bookings: unknown[] = []) {
  findMany.mockReset();
  findMany.mockImplementation((args: { where: Record<string, unknown> }) =>
    'patientId' in args.where ? Promise.resolve(bookings) : Promise.resolve(sent),
  );
}

beforeEach(() => {
  findMany.mockReset();
  findFirst.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('the follow-up funnel', () => {
  it('counts a reminder that was tapped and then booked', async () => {
    whenPrismaReturns(
      [{ id: 'visit-1', patientId: 'pat-1', followUpTappedAt: TAP }],
      [{ id: 'new-1', patientId: 'pat-1', createdAt: new Date('2026-09-20T05:02:00Z') }],
    );

    expect(await followUpFunnel('doc-1', SINCE)).toMatchObject({
      sent: 1,
      tapped: 1,
      booked: 1,
    });
  });

  it('counts a tap that never became a booking as tapped, not booked', async () => {
    whenPrismaReturns([{ id: 'visit-1', patientId: 'pat-1', followUpTappedAt: TAP }], []);

    expect(await followUpFunnel('doc-1', SINCE)).toMatchObject({
      sent: 1,
      tapped: 1,
      booked: 0,
    });
  });

  it('counts a reminder nobody tapped as sent only', async () => {
    whenPrismaReturns([{ id: 'visit-1', patientId: 'pat-1', followUpTappedAt: null }]);

    expect(await followUpFunnel('doc-1', SINCE)).toMatchObject({
      sent: 1,
      tapped: 0,
      booked: 0,
    });
  });

  /**
   * The visit that carried the reminder is itself an appointment for this
   * patient and doctor. Counting it would make every tap convert.
   */
  it('does not count the visit the reminder came from', async () => {
    whenPrismaReturns(
      [{ id: 'visit-1', patientId: 'pat-1', followUpTappedAt: TAP }],
      [{ id: 'visit-1', patientId: 'pat-1', createdAt: new Date('2026-09-20T06:00:00Z') }],
    );

    expect((await followUpFunnel('doc-1', SINCE)).booked).toBe(0);
  });

  /** An appointment made before the tap was not caused by it. */
  it('does not count a booking that predates the tap', async () => {
    whenPrismaReturns(
      [{ id: 'visit-1', patientId: 'pat-1', followUpTappedAt: TAP }],
      [{ id: 'new-1', patientId: 'pat-1', createdAt: new Date('2026-09-19T09:00:00Z') }],
    );

    expect((await followUpFunnel('doc-1', SINCE)).booked).toBe(0);
  });

  it('does not credit one patient with another patient s booking', async () => {
    whenPrismaReturns(
      [{ id: 'visit-1', patientId: 'pat-1', followUpTappedAt: TAP }],
      [{ id: 'new-1', patientId: 'pat-2', createdAt: new Date('2026-09-20T06:00:00Z') }],
    );

    expect((await followUpFunnel('doc-1', SINCE)).booked).toBe(0);
  });

  /** Multiplied by a consult fee, so a cancelled visit earns nothing. */
  it('leaves cancelled bookings out of the query entirely', async () => {
    whenPrismaReturns([{ id: 'visit-1', patientId: 'pat-1', followUpTappedAt: TAP }], []);

    await followUpFunnel('doc-1', SINCE);

    const bookingQuery = findMany.mock.calls
      .map((c) => c[0] as { where: Record<string, unknown> })
      .find((a) => 'patientId' in a.where);
    expect(bookingQuery?.where['status']).toEqual({ notIn: ['CANCELLED'] });
  });

  it('asks for bookings once, however many follow-ups there are', async () => {
    whenPrismaReturns(
      [
        { id: 'v1', patientId: 'pat-1', followUpTappedAt: TAP },
        { id: 'v2', patientId: 'pat-2', followUpTappedAt: TAP },
        { id: 'v3', patientId: 'pat-3', followUpTappedAt: TAP },
      ],
      [],
    );

    await followUpFunnel('doc-1', SINCE);

    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('does not go looking for bookings when nobody tapped', async () => {
    whenPrismaReturns([{ id: 'v1', patientId: 'pat-1', followUpTappedAt: null }]);

    await followUpFunnel('doc-1', SINCE);

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('reports zeroes rather than failing on a clinic that has sent nothing', async () => {
    whenPrismaReturns([]);

    expect(await followUpFunnel('doc-1', SINCE)).toMatchObject({
      sent: 0,
      tapped: 0,
      booked: 0,
    });
  });
});

describe('the reminder button payload', () => {
  it('round-trips an appointment id', () => {
    expect(parseFollowUpPayload(followUpPayload('appt-9'))).toBe('appt-9');
  });

  it.each(['book', '', '  ', 'FU:', 'fu:appt-9', 'my FU:appt-9'])(
    'reads %o as ordinary text',
    (input) => {
      expect(parseFollowUpPayload(input)).toBeNull();
    },
  );

  it('survives the whitespace a keyboard adds', () => {
    expect(parseFollowUpPayload('  FU:appt-9  ')).toBe('appt-9');
  });
});

describe('resolving a tap to a doctor', () => {
  const doctors = [{ id: 'doc-1' }, { id: 'doc-2' }];

  it('returns the doctor whose visit it was', async () => {
    findFirst.mockResolvedValue({ doctorId: 'doc-2' });

    expect(await doctorForFollowUpTap('appt-1', 'pat-1', doctors)).toBe('doc-2');
  });

  /**
   * The payload arrives as text the patient can type, so the query must be
   * narrowed by patient. A guessed id then looks exactly like a missing one.
   */
  it('scopes the lookup to the patient who sent it', async () => {
    findFirst.mockResolvedValue(null);

    await doctorForFollowUpTap('appt-1', 'pat-1', doctors);

    expect(findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 'appt-1', patientId: 'pat-1' },
    });
  });

  it('refuses an appointment that is not theirs', async () => {
    findFirst.mockResolvedValue(null);

    expect(await doctorForFollowUpTap('appt-1', 'pat-1', doctors)).toBeNull();
  });

  it('refuses a doctor the clinic no longer offers', async () => {
    findFirst.mockResolvedValue({ doctorId: 'doc-gone' });

    expect(await doctorForFollowUpTap('appt-1', 'pat-1', doctors)).toBeNull();
  });
});

describe('recording the tap', () => {
  it('stamps it only while it is unstamped, so a second tap changes nothing', async () => {
    await markFollowUpTapped('appt-1', TAP);

    expect(updateMany.mock.calls[0]![0]).toMatchObject({
      where: { id: 'appt-1', followUpTappedAt: null },
      data: { followUpTappedAt: TAP },
    });
  });
});
