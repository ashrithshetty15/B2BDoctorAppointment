import { t } from '../../i18n/templates';
import { Steps } from '../steps';
import { reply, type ConversationFlow } from '../types';

/**
 * SLOT MODE conversation flow — NOT YET IMPLEMENTED.
 *
 * Deliberately left as a stub: the prompt said to land TOKEN mode end-to-end as
 * a vertical slice before touching SLOT mode, and Section 4 (the authoritative
 * SLOT flow) was not supplied with the prompt.
 *
 * What already exists for it:
 *  - templates.ts: every SLOT string in EN + KN
 *  - domain/slots.ts: availability generation from working_hours, minus booked
 *    slots and leave_dates
 *  - queue/jobs/reminders.ts: day-before (6 PM) and 1-hour-before reminders
 *  - Steps.SLOT_* step names
 *
 * What remains: the step transitions below (date pick -> time pick -> confirm),
 * which is a ~150-line file once Section 4 pins down the exact prompts.
 */
export const slotFlow: ConversationFlow = {
  entryStep: Steps.SLOT_MENU,

  owns(step) {
    return step.startsWith('SLOT_');
  },

  async handle(ctx) {
    return {
      nextStep: Steps.SLOT_MENU,
      replies: [reply('notConfigured', t(ctx.language, 'notConfigured'))],
      data: {},
    };
  },
};
