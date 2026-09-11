import type { Language } from '@prisma/client';
import { t } from '../../i18n/templates';
import { isPlausibleName, setPatientLanguage, setPatientName } from '../../domain/patients';
import { clean, numericChoice } from '../intent';
import { Steps } from '../steps';
import { reply, type ConversationContext, type Reply, type StepResult } from '../types';

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

const LANGUAGE_WORDS = ['lang', 'language', 'bhashe', 'bhaashe', 'kannada', 'english'];

export function isLanguageSwitchRequest(input: string): boolean {
  return LANGUAGE_WORDS.includes(clean(input));
}

export async function runOnboarding(ctx: ConversationContext): Promise<OnboardingOutcome> {
  // A patient can ask for the language menu from anywhere.
  if (isLanguageSwitchRequest(ctx.input) && ctx.step !== Steps.AWAITING_LANGUAGE) {
    return {
      complete: false,
      result: {
        nextStep: Steps.AWAITING_LANGUAGE,
        replies: [reply('languagePrompt', t(ctx.language, 'languagePrompt'))],
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
              reply('askName', t(picked, 'askName', { clinicName: ctx.doctor.clinicName })),
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
            replies: [reply('languagePrompt', t(ctx.language, 'languagePrompt'))],
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
              clinicName: ctx.doctor.clinicName,
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
  if (c === 'english' || c === 'en') return 'EN';
  if (c === 'kannada' || c === 'kn') return 'KN';
  return null;
}
