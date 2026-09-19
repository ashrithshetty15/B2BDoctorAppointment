import type { Appointment, Clinic, Doctor, Patient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelAppointment } from '../../domain/appointments';
import {
  computePosition,
  findActiveToken,
  isOnLeave,
  issueToken,
} from '../../domain/tokenQueue';
import { Steps } from '../steps';
import type { ConversationContext } from '../types';
import { tokenFlow } from './token';

/**
 * TOKEN flow state machine tests.
 *
 * The domain layer is mocked, which is the point of requirement 8: the flow is
 * a pure decision over (step, input) and needs neither a database nor a
 * messaging provider to be tested.
 */

vi.mock('../../domain/tokenQueue', () => ({
  ACTIVE_TOKEN_STATUSES: ['BOOKED', 'ARRIVED', 'IN_PROGRESS'],
  findActiveToken: vi.fn(),
  issueToken: vi.fn(),
  computePosition: vi.fn(),
  isOnLeave: vi.fn(() => false),
}));

vi.mock('../../domain/appointments', () => ({
  cancelAppointment: vi.fn(),
}));

const doctor = {
  id: 'doc-1',
  name: 'Ramesh',
  clinicName: 'Sunrise Clinic',
  bookingMode: 'TOKEN',
  dailyTokenCap: 40,
  avgConsultTimeMins: 8,
  leaveDates: [],
  timezone: 'Asia/Kolkata',
} as unknown as Doctor;

const clinic = {
  id: 'clinic-1',
  name: 'Sunrise Clinic',
  timezone: 'Asia/Kolkata',
  defaultLanguage: 'EN',
} as unknown as Clinic;

const patient = { id: 'pat-1', phone: '919876543210', name: 'Asha', language: 'EN' } as Patient;

const today = new Date(Date.UTC(2026, 8, 14));

function ctx(step: string, input: string, data: Record<string, unknown> = {}): ConversationContext {
  return {
    clinic,
    doctor,
    doctorCount: 1,
    patient,
    step,
    data,
    language: 'EN',
    input,
    receivedAt: new Date('2026-09-14T04:00:00Z'),
    today,
  };
}

const appointment = {
  id: 'appt-1',
  doctorId: doctor.id,
  patientId: patient.id,
  date: today,
  type: 'TOKEN',
  status: 'BOOKED',
  tokenNumber: 12,
} as unknown as Appointment;

beforeEach(() => {
  vi.mocked(findActiveToken).mockReset().mockResolvedValue(null);
  vi.mocked(issueToken).mockReset();
  vi.mocked(cancelAppointment).mockReset();
  vi.mocked(isOnLeave).mockReset().mockReturnValue(false);
  vi.mocked(computePosition)
    .mockReset()
    .mockResolvedValue({ tokenNumber: 12, ahead: 4, etaMins: 32, nowServingToken: 7 });
});

describe('menu', () => {
  it('shows the menu on a fresh entry without treating it as a choice', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, ''));

    expect(result.nextStep).toBe(Steps.TOKEN_MENU);
    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenMainMenu']);
  });

  it('re-prompts on unrecognised input', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, 'blah blah'));

    expect(result.replies.map((r) => r.templateName)).toEqual(['unknownInput', 'tokenMainMenu']);
    expect(result.nextStep).toBe(Steps.TOKEN_MENU);
  });
});

describe('booking', () => {
  it('asks for confirmation before issuing a token', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, '1'));

    expect(result.nextStep).toBe(Steps.TOKEN_CONFIRM_BOOKING);
    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenConfirmPrompt']);
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('issues a token on confirmation and asks for a queue recalculation', async () => {
    vi.mocked(issueToken).mockResolvedValue({ ok: true, appointment, alreadyExisted: false });

    const result = await tokenFlow.handle(ctx(Steps.TOKEN_CONFIRM_BOOKING, '1'));

    expect(issueToken).toHaveBeenCalledWith(doctor, patient.id, today);
    expect(result.nextStep).toBe(Steps.TOKEN_MENU);
    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenBooked']);
    expect(result.replies[0]!.text).toContain('#12');
    expect(result.replies[0]!.text).toContain('32 mins');
    expect(result.effects).toEqual([
      {
        type: 'RECALC_TOKEN_QUEUE',
        doctorId: doctor.id,
        date: today,
        originAppointmentId: appointment.id,
      },
    ]);
  });

  it('does not book when the patient declines', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_CONFIRM_BOOKING, '2'));

    expect(issueToken).not.toHaveBeenCalled();
    expect(result.nextStep).toBe(Steps.TOKEN_MENU);
    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenMainMenu']);
  });

  it('re-asks rather than dropping the booking on junk input', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_CONFIRM_BOOKING, 'maybe'));

    expect(issueToken).not.toHaveBeenCalled();
    expect(result.nextStep).toBe(Steps.TOKEN_CONFIRM_BOOKING);
    expect(result.replies.map((r) => r.templateName)).toEqual([
      'unknownInput',
      'tokenConfirmPrompt',
    ]);
  });

  it('tells the patient when the daily cap is reached', async () => {
    vi.mocked(issueToken).mockResolvedValue({ ok: false, reason: 'CAP_REACHED' });

    const result = await tokenFlow.handle(ctx(Steps.TOKEN_CONFIRM_BOOKING, '1'));

    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenQueueFull']);
    expect(result.effects ?? []).toEqual([]);
  });

  it('does not double-book a patient who already holds a token', async () => {
    vi.mocked(findActiveToken).mockResolvedValue(appointment);

    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, '1'));

    expect(result.nextStep).toBe(Steps.TOKEN_MENU);
    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenAlreadyBooked']);
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('refuses to book on a leave date', async () => {
    vi.mocked(isOnLeave).mockReturnValue(true);

    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, '1'));

    expect(result.replies.map((r) => r.templateName)).toEqual(['doctorOnLeave']);
    expect(result.nextStep).toBe(Steps.TOKEN_MENU);
  });
});

describe('status', () => {
  it('reports position and ETA for an active token', async () => {
    vi.mocked(findActiveToken).mockResolvedValue(appointment);

    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, '2'));

    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenStatus']);
    expect(result.replies[0]!.text).toContain('#7'); // now serving
    expect(result.replies[0]!.text).toContain('4'); // patients ahead
  });

  it('says so when there is no active token', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, '2'));
    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenNoActiveBooking']);
  });
});

describe('cancellation', () => {
  it('confirms before cancelling and remembers which appointment', async () => {
    vi.mocked(findActiveToken).mockResolvedValue(appointment);

    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, '3'));

    expect(result.nextStep).toBe(Steps.TOKEN_CONFIRM_CANCEL);
    expect(result.data).toEqual({ appointmentId: 'appt-1', tokenNumber: 12 });
    expect(cancelAppointment).not.toHaveBeenCalled();
  });

  it('cancels on confirmation and triggers a recalculation', async () => {
    vi.mocked(cancelAppointment).mockResolvedValue({
      ...appointment,
      status: 'CANCELLED',
    } as Appointment);

    const result = await tokenFlow.handle(
      ctx(Steps.TOKEN_CONFIRM_CANCEL, '1', { appointmentId: 'appt-1', tokenNumber: 12 }),
    );

    expect(cancelAppointment).toHaveBeenCalledWith('appt-1', expect.any(Date));
    expect(result.replies.map((r) => r.templateName)).toEqual(['tokenCancelled']);
    expect(result.effects?.[0]).toMatchObject({ type: 'RECALC_TOKEN_QUEUE' });
  });

  it('keeps the token when the patient backs out', async () => {
    const result = await tokenFlow.handle(
      ctx(Steps.TOKEN_CONFIRM_CANCEL, '2', { appointmentId: 'appt-1', tokenNumber: 12 }),
    );

    expect(cancelAppointment).not.toHaveBeenCalled();
    expect(result.replies.map((r) => r.templateName)).toEqual([
      'tokenCancelAborted',
      'tokenMainMenu',
    ]);
  });

  it('recovers instead of crashing when session data was lost', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_CONFIRM_CANCEL, '1', {}));

    expect(cancelAppointment).not.toHaveBeenCalled();
    expect(result.replies.map((r) => r.templateName)).toEqual([
      'tokenNoActiveBooking',
      'tokenMainMenu',
    ]);
  });
});

describe('language', () => {
  it('renders the same flow in Kannada without any logic change', async () => {
    const result = await tokenFlow.handle({ ...ctx(Steps.TOKEN_MENU, ''), language: 'KN' });

    expect(result.replies[0]!.templateName).toBe('tokenMainMenu');
    // The body is the question; the options are the buttons. Asserting on the
    // button titles is what actually proves the menu is in Kannada — the body
    // alone would pass on a doctor's name and a date.
    expect(result.replies[0]!.text).toContain('ಇಂದು ನಾವು ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?');
    expect(result.replies[0]!.buttons?.map((b) => b.title)).toEqual([
      'ಟೋಕನ್ ಬುಕ್ ಮಾಡಿ',
      'ಟೋಕನ್ ಸ್ಥಿತಿ',
      'ಟೋಕನ್ ರದ್ದು ಮಾಡಿ',
    ]);
  });
});

/**
 * The numbered menus are gone — the buttons carry the options — but the numbers
 * were also the only way to answer on a client that renders nothing tappable,
 * so what replaced them has to work as typed input.
 */
describe('answering without tapping', () => {
  it.each(['book', 'status', 'cancel'])('accepts the typed word %s', async (word) => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, word));

    expect(result.replies[0]!.templateName).not.toBe('unknownInput');
  });

  it('still accepts the numbers it no longer prints', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, '1'));

    expect(result.nextStep).toBe(Steps.TOKEN_CONFIRM_BOOKING);
  });

  it('offers every menu option as a button, so nothing is reachable by number alone', async () => {
    const result = await tokenFlow.handle(ctx(Steps.TOKEN_MENU, ''));

    expect(result.replies[0]!.buttons).toHaveLength(3);
  });
});
