import { describe, expect, it } from 'vitest';
import { templates } from './templates';

/**
 * Guards the promise of requirement 7: language swapping never touches business
 * logic, so every language must implement every template and none may throw.
 */
describe('templates', () => {
  const languages = Object.keys(templates) as Array<keyof typeof templates>;

  it('registers the same template names for every language', () => {
    const reference = Object.keys(templates.EN).sort();
    for (const lang of languages) {
      expect(Object.keys(templates[lang]).sort(), `language ${lang}`).toEqual(reference);
    }
  });

  it('renders every template in every language without throwing', () => {
    // One params object that satisfies every template's shape.
    const params = {
      clinicName: 'Sunrise Clinic',
      doctorName: 'Ramesh',
      patientName: 'Asha',
      date: 'Fri, 11 Sep',
      time: '10:30 AM',
      tokenNumber: 12,
      nowServing: '#7',
      ahead: 4,
      eta: '32 mins',
      delayMins: 20,
      options: '1. 10:00 AM\n2. 10:30 AM',
      fromTime: '12:15 PM',
      toTime: '02:30 PM',
      // slotStatusMany renders a pre-built list of the appointments they hold.
      lines: '• *Fri, 11 Sep · 10:30 AM*',
    };

    for (const lang of languages) {
      for (const [name, render] of Object.entries(templates[lang])) {
        const text = (render as (p: typeof params) => string)(params);
        expect(typeof text, `${lang}.${name}`).toBe('string');
        expect(text.length, `${lang}.${name}`).toBeGreaterThan(0);
        // A missing param shows up as "undefined" in the rendered copy.
        expect(text, `${lang}.${name}`).not.toContain('undefined');
      }
    }
  });

  /**
   * SLOT mode stopped printing a numbered menu when the reply buttons took
   * over, but three templates went on telling patients to "Reply 3" — naming a
   * number nothing on screen shows. This catches the next one.
   *
   * No longer scoped to SLOT. TOKEN mode kept its numbered lists for a while
   * after SLOT dropped them, which is how a clinic ended up looking at a menu
   * reading "1. Book a token for today" under three buttons that said the same
   * thing. Every mode is held to it now, including the mode-choice question.
   */
  it('never tells a patient to reply with a number', () => {
    const params = {
      clinicName: 'Sunrise Clinic',
      doctorName: 'Ramesh',
      patientName: 'Asha',
      date: 'Fri, 11 Sep',
      time: '10:30 AM',
      fromTime: '12:15 PM',
      toTime: '02:30 PM',
      tokenNumber: 12,
      nowServing: '#7',
      ahead: 4,
      eta: '32 mins',
      delayMins: 20,
      options: '',
      // slotStatusMany renders a pre-built list of appointments.
      lines: '• *Fri, 11 Sep · 10:30 AM*',
    };

    for (const lang of languages) {
      for (const [name, render] of Object.entries(templates[lang])) {
        const text = (render as (p: typeof params) => string)(params);
        expect(text, `${lang}.${name}`).not.toMatch(/reply\s+(with\s+)?\d/i);
        expect(text, `${lang}.${name}`).not.toMatch(/\d\s*ಒತ್ತಿ/);
        // A numbered option line: "1. Book a token", "2. ನನ್ನ ಟೋಕನ್ ಸ್ಥಿತಿ".
        expect(text, `${lang}.${name}`).not.toMatch(/^\s*\d\.\s+\S/m);
      }
    }
  });
});
