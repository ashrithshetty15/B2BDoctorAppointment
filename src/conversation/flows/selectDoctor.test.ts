import type { Doctor } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { Steps } from '../steps';
import { askWhichDoctor, readDoctorChoice } from './selectDoctor';

const doc = (id: string, name: string, specialty?: string) =>
  ({ id, name, ...(specialty ? { specialty } : {}) }) as unknown as Doctor;

const THREE = [
  doc('d1', 'Arjun Rao', 'Paediatrician'),
  doc('d2', 'Kavya Shetty', 'Dermatologist'),
  doc('d3', 'Meera Nair', 'General Physician'),
];

describe('askWhichDoctor', () => {
  it('uses reply buttons when three or fewer fit', () => {
    const r = askWhichDoctor(THREE, 'EN');
    expect(r.nextStep).toBe(Steps.SELECT_DOCTOR);
    expect(r.replies[0]?.buttons?.map((b) => b.title)).toEqual([
      'Dr. Arjun Rao',
      'Dr. Kavya Shetty',
      'Dr. Meera Nair',
    ]);
    expect(r.replies[0]?.list).toBeUndefined();
  });

  it('falls back to a list past three, showing the specialty', () => {
    const four = [...THREE, doc('d4', 'Priya Iyer', 'Cardiologist')];
    const r = askWhichDoctor(four, 'EN');

    expect(r.replies[0]?.buttons).toBeUndefined();
    expect(r.replies[0]?.list?.rows).toHaveLength(4);
    expect(r.replies[0]?.list?.rows[3]?.description).toBe('Cardiologist');
  });

  /**
   * Carried by id, not position. The list is rebuilt from the database next
   * turn, and a doctor going on leave in between would otherwise silently shift
   * everyone else's number — booking the patient with someone they did not pick.
   */
  it('stores the offered doctor ids, in the order shown', () => {
    expect(askWhichDoctor(THREE, 'EN').data?.['doctorIds']).toEqual(['d1', 'd2', 'd3']);
  });

  it('keeps a long name inside the button limit', () => {
    const r = askWhichDoctor([doc('d1', 'Venkataraman Subramanian')], 'EN');
    const title = r.replies[0]?.buttons?.[0]?.title ?? '';
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.startsWith('Dr. Venkat')).toBe(true);
  });

  it('asks in Kannada when that is the patient language', () => {
    expect(askWhichDoctor(THREE, 'KN').replies[0]?.text).toMatch(/[ಀ-೿]/);
  });
});

describe('readDoctorChoice', () => {
  const offered = ['d1', 'd2', 'd3'];

  it('maps the tapped number to the doctor offered in that position', () => {
    const r = readDoctorChoice('2', offered, THREE, 'EN');
    expect(r.chosen?.id).toBe('d2');
  });

  it.each(['0', '4', 'abc', ''])('re-asks on %s rather than guessing', (input) => {
    const r = readDoctorChoice(input, offered, THREE, 'EN');
    expect(r.chosen).toBeNull();
  });

  /**
   * The doctor was offered, then stopped being bookable. Re-offering the list
   * that is current now is right — silently booking a neighbour would not be.
   */
  it('re-asks when the chosen doctor is no longer available', () => {
    const remaining = [THREE[0]!, THREE[2]!];
    const r = readDoctorChoice('2', offered, remaining, 'EN');

    expect(r.chosen).toBeNull();
    if (r.chosen === null) {
      expect(r.result.replies[0]?.templateName).toBe('selectDoctorInvalid');
      expect(r.result.data?.['doctorIds']).toEqual(['d1', 'd3']);
    }
  });

  /** Positions follow the offer, not today's list. */
  it('honours the order the patient actually saw', () => {
    const reordered = [THREE[2]!, THREE[1]!, THREE[0]!];
    const r = readDoctorChoice('1', offered, reordered, 'EN');
    expect(r.chosen?.id).toBe('d1');
  });
});
