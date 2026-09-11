import { t } from '../../i18n/templates';
import { numericChoice } from '../intent';
import { Steps } from '../steps';
import { reply, type ConversationFlow, type ConversationContext } from '../types';
import { slotFlow } from './slot';
import { tokenFlow } from './token';

/**
 * HYBRID MODE — asks the patient which kind of visit they want, then hands the
 * conversation to the TOKEN or SLOT flow for the rest of the turn and every
 * turn after (the chosen branch is implied by the step name we park on).
 *
 * NOTE: Section 5 was not supplied with the prompt. The behaviour implemented
 * here is the minimal reading of "HYBRID = offer both": one extra question at
 * the top of the conversation, no other changes to either flow. If Section 5
 * instead means e.g. "slots in the morning, tokens in the evening", only this
 * file changes.
 */
export const hybridFlow: ConversationFlow = {
  entryStep: Steps.HYBRID_AWAITING_MODE,

  owns(step) {
    return step === Steps.HYBRID_AWAITING_MODE || tokenFlow.owns(step) || slotFlow.owns(step);
  },

  async handle(ctx) {
    // Already committed to a branch — delegate.
    if (tokenFlow.owns(ctx.step)) return tokenFlow.handle(ctx);
    if (slotFlow.owns(ctx.step)) return slotFlow.handle(ctx);

    return askOrRoute(ctx);
  },
};

async function askOrRoute(ctx: ConversationContext) {
  const choice = numericChoice(ctx.input);

  if (choice === 1) {
    return slotFlow.handle({ ...ctx, step: slotFlow.entryStep, input: '' });
  }
  if (choice === 2) {
    return tokenFlow.handle({ ...ctx, step: tokenFlow.entryStep, input: '' });
  }

  const replies =
    ctx.input.trim() === ''
      ? []
      : [reply('unknownInput', t(ctx.language, 'unknownInput'))];

  return {
    nextStep: Steps.HYBRID_AWAITING_MODE,
    replies: [
      ...replies,
      reply(
        'hybridModeChoice',
        t(ctx.language, 'hybridModeChoice', { doctorName: ctx.doctor.name }),
      ),
    ],
    data: {},
  };
}
