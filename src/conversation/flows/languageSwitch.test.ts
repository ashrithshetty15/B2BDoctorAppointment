import { describe, expect, it } from 'vitest';
import { isLanguageSwitchRequest } from './onboarding';

/**
 * Getting back out of a language you cannot read.
 *
 * Choosing Kannada rewrites every prompt into Kannada script, and the only way
 * back was to type one of six Latin-script words — 'lang', 'language',
 * 'bhashe', 'bhaashe', 'kannada', 'english'. A patient who picked Kannada
 * because they read Kannada would naturally type ಭಾಷೆ, and get
 * "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ" — sorry, I didn't understand.
 *
 * The escape hatch only answered to words the trapped patient was least likely
 * to type. Worse, the app's own Kannada copy teaches them the word it did not
 * accept: languagePrompt reads "ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ".
 *
 * languageFromWord already accepted ಕನ್ನಡ and ಇಂಗ್ಲಿಷ್ — but only once the
 * menu was open, which was the part they could not reach.
 */
describe('asking to change language', () => {
  describe('in Kannada script, which is what a Kannada reader would type', () => {
    it.each([
      ['ಭಾಷೆ', 'the word the app\'s own prompt uses for "language"'],
      ['ಕನ್ನಡ', 'the label on the button they originally tapped'],
      ['ಇಂಗ್ಲಿಷ್', 'the language they want to get back to'],
    ])('opens the language menu for %s (%s)', (word) => {
      expect(isLanguageSwitchRequest(word)).toBe(true);
    });
  });

  describe('in Latin script, unchanged', () => {
    it.each(['language', 'lang', 'english', 'kannada', 'bhashe', 'bhaashe'])(
      'still opens the language menu for %s',
      (word) => {
        expect(isLanguageSwitchRequest(word)).toBe(true);
      },
    );

    /** Romanised Kannada is how a lot of people actually type on a phone. */
    it.each(['bhasha', 'bhaasha', 'basha'])('accepts the romanised spelling %s', (word) => {
      expect(isLanguageSwitchRequest(word)).toBe(true);
    });
  });

  it('is case and whitespace tolerant, as the rest of the parser is', () => {
    expect(isLanguageSwitchRequest('  LANGUAGE  ')).toBe(true);
    expect(isLanguageSwitchRequest(' ಭಾಷೆ ')).toBe(true);
  });

  /**
   * It must stay a narrow match. This check runs before every step, so a word
   * that collides with ordinary input would hijack a booking mid-flow.
   */
  it.each(['book', '1', 'cancel', 'my appointments', 'ಬುಕ್', 'Ramesh'])(
    'leaves ordinary input alone: %s',
    (word) => {
      expect(isLanguageSwitchRequest(word)).toBe(false);
    },
  );

  it('does not fire on a sentence that merely contains the word', () => {
    expect(isLanguageSwitchRequest('what language do you speak')).toBe(false);
  });
});
