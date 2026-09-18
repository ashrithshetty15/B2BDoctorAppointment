import { describe, expect, it } from 'vitest';
import { boardMain, boardPage, type BoardData } from './displayView';

const base: BoardData = {
  clinicName: 'Sunrise Clinic',
  doctorName: 'Ramesh Kumar',
  specialty: 'General Physician',
  mode: 'TOKEN',
  nowServing: '6',
  next: ['7', '8', '9'],
  waiting: 4,
  delayMins: 0,
  isClosed: false,
  whatsappNumber: '919731028452',
  updatedAt: '10:42 AM',
};

const board = (over: Partial<BoardData> = {}) => boardPage({ ...base, ...over });
const main = (over: Partial<BoardData> = {}) => boardMain({ ...base, ...over }).__html;

/**
 * A waiting room is a room full of strangers. A screen naming patients
 * publishes personal data to all of them, so the board shows the number and the
 * receptionist calls the name.
 *
 * This is the assertion that must not rot: the data layer already selects only
 * `tokenNumber`, and this is the second lock on the same door.
 */
describe('patient privacy', () => {
  it('never renders a patient name, even when one is passed through', () => {
    const rendered = board({
      // Not part of BoardData at all — the point is that nothing downstream can
      // smuggle one in via a spread.
      ...({ patientName: 'Fatima Begum' } as Partial<BoardData>),
    });

    expect(rendered).not.toContain('Fatima');
    expect(rendered).not.toContain('Begum');
  });

  it('carries only the doctor and clinic as names', () => {
    const rendered = board();
    expect(rendered).toContain('Sunrise Clinic');
    expect(rendered).toContain('Ramesh Kumar');
  });

  it('asks search engines not to index it', () => {
    expect(board()).toContain('noindex');
  });
});

/**
 * Five real states. A wall screen is on for eight hours and spends most of that
 * time in one of the quiet ones, so none of them may render as an empty box.
 */
describe('states', () => {
  it('shows the token at room scale when someone is being seen', () => {
    const out = main();
    expect(out).toContain('Now serving');
    expect(out).toContain('6');
    expect(out).toContain('class="hero"');
  });

  it('says the day has not started rather than showing nothing', () => {
    const out = main({ nowServing: null, waiting: 3 });
    expect(out).toContain('Not started yet');
    expect(out).toContain('Please take a seat');
    expect(out).toContain('3 waiting');
  });

  it('distinguishes an empty queue from one that has not been called', () => {
    expect(main({ nowServing: null, waiting: 0 })).toContain('No one waiting');
  });

  it('says the list is closed, and how many are still to be seen', () => {
    const out = main({ isClosed: true, waiting: 2 });
    expect(out).toContain('closed');
    expect(out).toContain('2 still waiting');
    // Closed wins over the number: nobody new should read a token off the wall.
    expect(out).not.toContain('class="hero"');
  });

  it('marks the last patient rather than showing an empty Next', () => {
    const out = main({ next: [] });
    expect(out).toContain('Last patient');
    expect(out).not.toContain('next-label');
  });

  it('shows a delay when the clinic is running late', () => {
    expect(board({ delayMins: 25 })).toContain('25 minutes late');
  });

  it('says nothing about delay when there is none', () => {
    expect(board({ delayMins: 0 })).not.toContain('minutes late');
  });
});

describe('slot clinics', () => {
  /** A slot clinic has no token numbers; a blank wall screen is not acceptable. */
  it('reads in times instead of numbers, with no stray hash', () => {
    const out = main({ mode: 'SLOT', nowServing: '10:40 AM', next: ['11:00 AM'] });
    expect(out).toContain('Now seeing');
    expect(out).toContain('10:40 AM');
    expect(out).not.toContain('class="hash"');
  });
});

describe('the board as a surface', () => {
  /** The wall is the one place every patient looks; it may as well recruit. */
  it('tells the room how to book next time', () => {
    expect(board()).toContain('Book on WhatsApp');
    expect(board()).toContain('+919731028452');
  });

  it('omits the booking line when the clinic has no number yet', () => {
    expect(board({ whatsappNumber: null })).not.toContain('Book on WhatsApp');
  });

  /** It runs unattended for days; losing the network must not blank the room. */
  it('ships the reconnect handling with the page', () => {
    const out = board();
    expect(out).toContain('stale');
    expect(out).toContain('fragment=1');
  });

  it('escapes a clinic name with markup in it', () => {
    const out = board({ clinicName: 'A & B <script>x</script>' });
    expect(out).not.toContain('<script>x</script>');
    expect(out).toContain('&amp;');
  });
});
