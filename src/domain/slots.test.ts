import type { Doctor } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { dateOnly, formatTimeForPatient } from '../utils/time';
import { dayKeyFor, generateSlots, parseWorkingHours } from './slots';

function makeDoctor(overrides: Partial<Doctor> = {}): Doctor {
  return {
    id: 'doc-1',
    name: 'Ramesh',
    clinicName: 'Sunrise Clinic',
    phone: '919000000001',
    whatsappPhoneNumberId: null,
    bookingMode: 'SLOT',
    bookingModeLockedAt: null,
    dailyTokenCap: 40,
    consultDurationMins: 15,
    avgConsultTimeMins: 15,
    consultSampleCount: 0,
    workingHours: { mon: [{ start: '09:00', end: '10:00' }] },
    leaveDates: [],
    defaultLanguage: 'EN',
    timezone: 'Asia/Kolkata',
    apiKey: 'dk_test',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Doctor;
}

// 2026-09-14 is a Monday.
const monday = dateOnly(2026, 9, 14);
const sunday = dateOnly(2026, 9, 13);

describe('parseWorkingHours', () => {
  it('keeps well-formed windows', () => {
    const parsed = parseWorkingHours({ mon: [{ start: '09:00', end: '13:00' }] });
    expect(parsed.mon).toEqual([{ start: '09:00', end: '13:00' }]);
  });

  it('drops malformed input instead of throwing', () => {
    expect(parseWorkingHours(null)).toEqual({});
    expect(parseWorkingHours('nope')).toEqual({});
    expect(parseWorkingHours({ mon: 'nine to five' })).toEqual({});
    expect(parseWorkingHours({ mon: [{ start: '9am', end: '1pm' }] })).toEqual({});
  });
});

describe('dayKeyFor', () => {
  it('maps a date to its weekday key', () => {
    expect(dayKeyFor(monday)).toBe('mon');
    expect(dayKeyFor(sunday)).toBe('sun');
  });
});

describe('generateSlots', () => {
  it('divides each window by consult duration', () => {
    const doctor = makeDoctor();
    const slots = generateSlots(doctor, monday);

    expect(slots).toHaveLength(4);
    expect(formatTimeForPatient(slots[0]!.start, doctor.timezone)).toBe('09:00 AM');
    expect(formatTimeForPatient(slots[3]!.start, doctor.timezone)).toBe('09:45 AM');
    expect(formatTimeForPatient(slots[3]!.end, doctor.timezone)).toBe('10:00 AM');
  });

  it('never produces a slot that overruns the window', () => {
    // 50-minute window, 15-minute consults -> 3 slots, last ends 09:45.
    const doctor = makeDoctor({ workingHours: { mon: [{ start: '09:00', end: '09:50' }] } });
    const slots = generateSlots(doctor, monday);

    expect(slots).toHaveLength(3);
    expect(formatTimeForPatient(slots[2]!.end, doctor.timezone)).toBe('09:45 AM');
  });

  it('handles multiple windows in a day', () => {
    const doctor = makeDoctor({
      consultDurationMins: 30,
      workingHours: {
        mon: [
          { start: '09:00', end: '10:00' },
          { start: '17:00', end: '18:00' },
        ],
      },
    });

    const slots = generateSlots(doctor, monday);
    expect(slots).toHaveLength(4);
    expect(formatTimeForPatient(slots[2]!.start, doctor.timezone)).toBe('05:00 PM');
  });

  it('returns nothing on a non-working day', () => {
    expect(generateSlots(makeDoctor(), sunday)).toEqual([]);
  });

  it('returns nothing on a leave date', () => {
    const doctor = makeDoctor({ leaveDates: [monday] });
    expect(generateSlots(doctor, monday)).toEqual([]);
  });
});
