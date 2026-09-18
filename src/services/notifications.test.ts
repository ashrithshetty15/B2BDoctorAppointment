import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment, Patient } from '@prisma/client';
import type { DoctorWithChannel } from '../domain/doctors';

const enqueueOutboundBulk = vi.fn();

vi.mock('../queue/queues', () => ({
  enqueueOutboundBulk: (...args: unknown[]) => enqueueOutboundBulk(...args),
  enqueueOutbound: vi.fn(),
}));
// Imported for its Prisma client at module load; this path touches no queries.
vi.mock('../db/prisma', () => ({ prisma: {} }));

// vi.mock is hoisted above this import, so the mocks are in place.
import { notifyCancelledByClinic } from './notifications';

/**
 * What a patient is actually told when their booking is cancelled out from under
 * them. This had no test at all, while being the only thing standing between a
 * closed day and a patient turning up to a locked clinic.
 */

const doctor = {
  id: 'doc1',
  name: 'Meera Nair',
  clinicName: 'Lakeview Clinic',
  timezone: 'Asia/Kolkata',
  // No number of their own: at a multi-doctor clinic only one row ever carried
  // it, and the clinic is where it lives now.
  whatsappPhoneNumberId: null,
  clinic: { whatsappPhoneNumberId: 'pn-clinic' },
} as unknown as DoctorWithChannel;

const patient = (over: Partial<Patient> = {}): Patient =>
  ({
    id: 'p1',
    phone: '919876543210',
    name: 'Prakash',
    language: 'EN',
    ...over,
  }) as Patient;

const appointment = (over: Partial<Appointment> = {}) =>
  ({
    id: 'a1',
    type: 'TOKEN',
    tokenNumber: 7,
    slotStart: null,
    date: new Date(Date.UTC(2026, 8, 14)),
    ...over,
  }) as Appointment;

beforeEach(() => {
  enqueueOutboundBulk.mockReset();
});

describe('notifyCancelledByClinic', () => {
  it('sends one message per appointment, in one bulk enqueue', async () => {
    const rows = [
      { ...appointment({ id: 'a1' }), patient: patient() },
      { ...appointment({ id: 'a2', tokenNumber: 8 }), patient: patient({ id: 'p2' }) },
    ];

    const { notified } = await notifyCancelledByClinic(doctor, rows);

    expect(notified).toBe(2);
    // One round trip, not one per patient — a closed day can be a full list.
    expect(enqueueOutboundBulk).toHaveBeenCalledTimes(1);
    expect(enqueueOutboundBulk.mock.calls[0]?.[0]).toHaveLength(2);
  });

  /**
   * The number belongs to the clinic, and at a multi-doctor practice only one
   * doctor row ever carried it. Reading the doctor alone left every other
   * doctor's messages with no channel, which silently falls back to the
   * environment default — a different clinic's number entirely.
   */
  it('addresses each job to the patient, from the clinic number', async () => {
    await notifyCancelledByClinic(doctor, [{ ...appointment(), patient: patient() }]);

    const [job] = enqueueOutboundBulk.mock.calls[0]?.[0] as {
      to: string;
      text: string;
      channelAddress?: string;
    }[];
    expect(job?.to).toBe('919876543210');
    expect(job?.channelAddress).toBe('pn-clinic');
  });

  /** A solo clinic whose number is still only on the doctor row keeps working. */
  it('falls back to the doctor own number when the clinic has none', async () => {
    const solo = {
      ...doctor,
      whatsappPhoneNumberId: 'pn-solo',
      clinic: null,
    } as unknown as typeof doctor;

    await notifyCancelledByClinic(solo, [{ ...appointment(), patient: patient() }]);

    const [job] = enqueueOutboundBulk.mock.calls[0]?.[0] as { channelAddress?: string }[];
    expect(job?.channelAddress).toBe('pn-solo');
  });

  it('names the token and the date for a token booking', async () => {
    await notifyCancelledByClinic(doctor, [
      { ...appointment({ tokenNumber: 7 }), patient: patient() },
    ]);
    const [job] = enqueueOutboundBulk.mock.calls[0]?.[0] as { text: string }[];
    expect(job?.text).toContain('7');
    expect(job?.text).toMatch(/Sep/);
  });

  it('names the time for a slot booking', async () => {
    await notifyCancelledByClinic(doctor, [
      {
        ...appointment({
          type: 'SLOT',
          tokenNumber: null,
          slotStart: new Date('2026-09-14T10:30:00+05:30'),
        }),
        patient: patient(),
      },
    ]);
    const [job] = enqueueOutboundBulk.mock.calls[0]?.[0] as { text: string }[];
    // Rendered in the clinic's timezone, not UTC.
    expect(job?.text).toContain('10:30');
  });

  /** Each patient hears from the clinic in their own language, not the doctor's. */
  it('writes to each patient in their own language', async () => {
    await notifyCancelledByClinic(doctor, [
      { ...appointment({ id: 'a1' }), patient: patient({ language: 'EN' }) },
      { ...appointment({ id: 'a2' }), patient: patient({ id: 'p2', language: 'KN' }) },
    ]);

    const jobs = enqueueOutboundBulk.mock.calls[0]?.[0] as { text: string }[];
    expect(jobs[0]?.text).not.toBe(jobs[1]?.text);
    // Kannada script, so the second is not an English fallback.
    expect(jobs[1]?.text).toMatch(/[ಀ-೿]/);
  });

  it('enqueues nothing when no one was booked', async () => {
    const { notified } = await notifyCancelledByClinic(doctor, []);
    expect(notified).toBe(0);
    // enqueueOutboundBulk itself no-ops on an empty list, but it is still called.
    expect(enqueueOutboundBulk.mock.calls[0]?.[0]).toEqual([]);
  });
});
