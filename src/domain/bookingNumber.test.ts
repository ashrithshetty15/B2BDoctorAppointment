import type { Doctor } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { bookingNumberFor, type DoctorWithChannel } from './doctors';

const doc = (over: Partial<DoctorWithChannel>): DoctorWithChannel =>
  ({ whatsappNumber: null, clinic: null, ...over }) as unknown as DoctorWithChannel;

/**
 * The QR code and the wa.me link are built from this.
 *
 * Found in use: Lakeview's Bookings page showed "show this code at reception"
 * over an empty box. Two doctors there were added after clinics took ownership
 * of the number, so their own column is null and reading it alone left them
 * with no QR anywhere in the console.
 */
describe('bookingNumberFor', () => {
  it('uses the clinic number for a doctor who has none of their own', () => {
    expect(bookingNumberFor(doc({ clinic: { whatsappNumber: '919731028452', whatsappPhoneNumberId: 'pn' } }))).toBe(
      '919731028452',
    );
  });

  /** The clinic owns the number, so it wins even where both are set. */
  it('prefers the clinic over a stale copy on the doctor', () => {
    const d = doc({
      whatsappNumber: '910000000000',
      clinic: { whatsappNumber: '919731028452', whatsappPhoneNumberId: 'pn' },
    });
    expect(bookingNumberFor(d)).toBe('919731028452');
  });

  /** A solo clinic set up before clinics existed keeps working. */
  it('falls back to the doctor own number', () => {
    expect(bookingNumberFor(doc({ whatsappNumber: '15553012465' }))).toBe('15553012465');
  });

  it('is null when neither has one, so callers hide the QR', () => {
    expect(bookingNumberFor(doc({}))).toBeNull();
    expect(bookingNumberFor(doc({ clinic: { whatsappNumber: null, whatsappPhoneNumberId: 'pn' } }))).toBeNull();
  });
});
