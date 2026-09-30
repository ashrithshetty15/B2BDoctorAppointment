import type { Language } from '@prisma/client';
import { t } from '../../i18n/templates';
import { isPlausibleName, setPatientLanguage, setPatientName } from '../../domain/patients';
import { clean, numericChoice } from '../intent';
import { Steps } from '../steps';
import { reply, type ConversationContext, type Reply, type StepResult } from '../types';
import type { ReplyButton } from '../../messaging/types';

/**
 * Mode-independent onboarding: language choice, then name capture. Runs before
 * any booking flow so TOKEN/SLOT/HYBRID all get a named, language-tagged
 * patient without duplicating these steps.
 */

export type OnboardingOutcome =
  | { complete: false; result: StepResult }
  | {
      complete: true;
      /** Messages to emit before the flow's own reply (e.g. welcome back). */
      prefixReplies: Reply[];
      /**
       * True when onboarding advanced this turn, meaning the patient's input was
       * consumed here and the flow should render its entry prompt rather than
       * interpret the text as a menu choice.
       */
      enterFlowFresh: boolean;
      /** Fields changed on the patient during onboarding. */
      patch: { name?: string; language?: Language };
    };

/**
 * The words that reopen the language menu.
 *
 * Kannada script matters more than the Latin spellings here, not less. Picking
 * Kannada rewrites every prompt into Kannada, so the patient most likely to
 * want out is the one least able to type 'language' — and the list used to hold
 * Latin words only. They typed ಭಾಷೆ, the exact word this app's own prompt uses
 * ("ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ"), and got "sorry, I didn't understand".
 *
 * languageFromWord below already accepted ಕನ್ನಡ and ಇಂಗ್ಲಿಷ್, but only once the
 * menu was open — which was the part they could not reach.
 *
 * Romanised spellings are here because that is how a great many people type
 * Kannada on a phone keyboard.
 */
const LANGUAGE_WORDS = [
  // English
  'lang',
  'language',
  'english',
  'kannada',
  // Romanised Kannada
  'bhashe',
  'bhaashe',
  'bhasha',
  'bhaasha',
  'basha',
  // Kannada script
  'ಭಾಷೆ',
  'ಕನ್ನಡ',
  'ಇಂಗ್ಲಿಷ್',
  'ಇಂಗ್ಲೀಷ್',
  'ಆಂಗ್ಲ',
];

export function isLanguageSwitchRequest(input: string): boolean {
  return LANGUAGE_WORDS.includes(clean(input));
}

/**
 * The same tokens the typed flow accepts, so tapping and typing are the same
 * input as far as every step is concerned — an inbound button tap arrives as
 * its id (see extractText in the WhatsApp adapter).
 */
function languageButtons(language: Language): ReplyButton[] {
  return [
    { id: '1', title: t(language, 'btnEnglish') },
    { id: '2', title: t(language, 'btnKannada') },
  ];
}

export async function runOnboarding(ctx: ConversationContext): Promise<OnboardingOutcome> {
  // A patient can ask for the language menu from anywhere.
  if (isLanguageSwitchRequest(ctx.input) && ctx.step !== Steps.AWAITING_LANGUAGE) {
    return {
      complete: false,
      result: {
        nextStep: Steps.AWAITING_LANGUAGE,
        replies: [reply('languagePrompt', t(ctx.language, 'languagePrompt'), languageButtons(ctx.language))],
      },
    };
  }

  switch (ctx.step) {
    case Steps.AWAITING_LANGUAGE: {
      const choice = numericChoice(ctx.input);
      const picked: Language | null =
        choice === 1 ? 'EN' : choice === 2 ? 'KN' : languageFromWord(ctx.input);

      if (!picked) {
        return {
          complete: false,
          result: {
            nextStep: Steps.AWAITING_LANGUAGE,
            replies: [reply('languageInvalid', t(ctx.language, 'languageInvalid'))],
          },
        };
      }

      await setPatientLanguage(ctx.patient.id, picked);

      if (!ctx.patient.name) {
        return {
          complete: false,
          result: {
            nextStep: Steps.AWAITING_NAME,
            language: picked,
            replies: [
              reply('askName', t(picked, 'askName', { clinicName: ctx.clinic.name })),
            ],
          },
        };
      }

      return {
        complete: true,
        prefixReplies: [],
        enterFlowFresh: true,
        patch: { language: picked },
      };
    }

    case Steps.AWAITING_NAME: {
      if (!isPlausibleName(ctx.input)) {
        return {
          complete: false,
          result: {
            nextStep: Steps.AWAITING_NAME,
            replies: [reply('nameInvalid', t(ctx.language, 'nameInvalid'))],
          },
        };
      }

      const name = ctx.input.trim().slice(0, 80);
      await setPatientName(ctx.patient.id, name);

      return {
        complete: true,
        prefixReplies: [],
        enterFlowFresh: true,
        patch: { name },
      };
    }

    case Steps.ENTRY: {
      if (!ctx.patient.name) {
        return {
          complete: false,
          result: {
            nextStep: Steps.AWAITING_LANGUAGE,
            replies: [reply('languagePrompt', t(ctx.language, 'languagePrompt'), languageButtons(ctx.language))],
          },
        };
      }

      return {
        complete: true,
        prefixReplies: [
          reply(
            'welcomeBack',
            t(ctx.language, 'welcomeBack', {
              patientName: ctx.patient.name,
              clinicName: ctx.clinic.name,
            }),
          ),
        ],
        enterFlowFresh: true,
        patch: {},
      };
    }

    default:
      // Mid-flow step — onboarding has nothing to do; pass the input through.
      return { complete: true, prefixReplies: [], enterFlowFresh: false, patch: {} };
  }
}

function languageFromWord(input: string): Language | null {
  const c = clean(input);
  if (c === 'english' || c === 'en' || c === 'ಇಂಗ್ಲಿಷ್') return 'EN';
  if (c === 'kannada' || c === 'kn' || c === 'ಕನ್ನಡ') return 'KN';
  return null;
}
