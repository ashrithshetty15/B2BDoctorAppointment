import { cancelAppointment } from '../../domain/appointments';
import {
  computePosition,
  findActiveToken,
  isOnLeave,
  issueToken,
} from '../../domain/tokenQueue';
import { nowServingLabel } from '../../i18n/format';
import { t } from '../../i18n/templates';
import { formatDateForPatient, formatWait } from '../../utils/time';
import { isNo, isYes, menuIntent } from '../intent';
import { Steps } from '../steps';
import { reply, type ConversationFlow, type ConversationContext, type StepResult } from '../types';

/**
 * TOKEN MODE conversation flow.
 *
 * NOTE: Section 3 of the spec (the authoritative TOKEN flow) was not supplied
 * with the prompt. This implements the conventional flow those requirements
 * imply:
 *
 *   ENTRY ─ onboarding (language, name) ─▶ TOKEN_MENU
 *   TOKEN_MENU
 *     1 / "book"    ─▶ TOKEN_CONFIRM_BOOKING ─ yes ─▶ token issued ─▶ TOKEN_MENU
 *     2 / "status"  ─▶ position + ETA        ─▶ TOKEN_MENU
 *     3 / "cancel"  ─▶ TOKEN_CONFIRM_CANCEL  ─ yes ─▶ cancelled   ─▶ TOKEN_MENU
 *
 * Replace the branch order / prompts here and the copy in templates.ts to match
 * Section 3 exactly; nothing outside these two files depends on the wording.
 */
export const tokenFlow: ConversationFlow = {
  entryStep: Steps.TOKEN_MENU,

  owns(step) {
    return (
      step === Steps.TOKEN_MENU ||
      step === Steps.TOKEN_CONFIRM_BOOKING ||
      step === Steps.TOKEN_CONFIRM_CANCEL
    );
  },

  async handle(ctx) {
    switch (ctx.step) {
      case Steps.TOKEN_CONFIRM_BOOKING:
        return handleBookingConfirmation(ctx);
      case Steps.TOKEN_CONFIRM_CANCEL:
        return handleCancelConfirmation(ctx);
      case Steps.TOKEN_MENU:
      default:
        return handleMenu(ctx);
    }
  },
};

/** The main menu, used both as a prompt and as a fallback. */
function menuResult(ctx: ConversationContext, extraFirst?: StepResult['replies']): StepResult {
  return {
    nextStep: Steps.TOKEN_MENU,
    replies: [
      ...(extraFirst ?? []),
      reply(
        'tokenMainMenu',
        t(ctx.language, 'tokenMainMenu', {
          doctorName: ctx.doctor.name,
          date: formatDateForPatient(ctx.today),
        }),
      ),
    ],
    data: {},
  };
}

async function handleMenu(ctx: ConversationContext): Promise<StepResult> {
  // Fresh arrival at the menu (onboarding just finished, or "hi"): just show it.
  if (ctx.input.trim() === '') return menuResult(ctx);

  switch (menuIntent(ctx.input)) {
    case 'BOOK':
      return startBooking(ctx);
    case 'STATUS':
      return showStatus(ctx);
    case 'CANCEL':
      return startCancel(ctx);
    case 'UNKNOWN':
    default:
      return menuResult(ctx, [reply('unknownInput', t(ctx.language, 'unknownInput'))]);
  }
}

async function startBooking(ctx: ConversationContext): Promise<StepResult> {
  const existing = await findActiveToken(ctx.doctor.id, ctx.patient.id, ctx.today);
  if (existing) {
    const pos = await computePosition(existing, ctx.doctor);
    return {
      nextStep: Steps.TOKEN_MENU,
      replies: [
        reply(
          'tokenAlreadyBooked',
          t(ctx.language, 'tokenAlreadyBooked', {
            tokenNumber: pos.tokenNumber,
            ahead: pos.ahead,
            eta: formatWait(pos.etaMins),
          }),
        ),
      ],
      data: {},
    };
  }

  if (isOnLeave(ctx.doctor, ctx.today)) {
    return {
      nextStep: Steps.TOKEN_MENU,
      replies: [
        reply(
          'doctorOnLeave',
          t(ctx.language, 'doctorOnLeave', {
            doctorName: ctx.doctor.name,
            date: formatDateForPatient(ctx.today),
          }),
        ),
      ],
      data: {},
    };
  }

  return {
    nextStep: Steps.TOKEN_CONFIRM_BOOKING,
    replies: [
      reply(
        'tokenConfirmPrompt',
        t(ctx.language, 'tokenConfirmPrompt', {
          doctorName: ctx.doctor.name,
          date: formatDateForPatient(ctx.today),
        }),
      ),
    ],
    data: {},
  };
}

async function handleBookingConfirmation(ctx: ConversationContext): Promise<StepResult> {
  if (isNo(ctx.input)) return menuResult(ctx);

  if (!isYes(ctx.input)) {
    // Re-ask rather than silently dropping the booking.
    return {
      nextStep: Steps.TOKEN_CONFIRM_BOOKING,
      replies: [
        reply('unknownInput', t(ctx.language, 'unknownInput')),
        reply(
          'tokenConfirmPrompt',
          t(ctx.language, 'tokenConfirmPrompt', {
            doctorName: ctx.doctor.name,
            date: formatDateForPatient(ctx.today),
          }),
        ),
      ],
    };
  }

  const result = await issueToken(ctx.doctor, ctx.patient.id, ctx.today);

  if (!result.ok) {
    const replies =
      result.reason === 'CAP_REACHED'
        ? [
            reply(
              'tokenQueueFull',
              t(ctx.language, 'tokenQueueFull', { doctorName: ctx.doctor.name }),
            ),
          ]
        : result.reason === 'LIST_CLOSED'
          ? [reply('tokenListClosed', t(ctx.language, 'tokenListClosed'))]
          : [
              reply(
                'doctorOnLeave',
                t(ctx.language, 'doctorOnLeave', {
                  doctorName: ctx.doctor.name,
                  date: formatDateForPatient(ctx.today),
                }),
              ),
            ];
    return { nextStep: Steps.TOKEN_MENU, replies, data: {} };
  }

  const { appointment } = result;
  const pos = await computePosition(appointment, ctx.doctor);

  const confirmation = reply(
    result.alreadyExisted ? 'tokenAlreadyBooked' : 'tokenBooked',
    result.alreadyExisted
      ? t(ctx.language, 'tokenAlreadyBooked', {
          tokenNumber: pos.tokenNumber,
          ahead: pos.ahead,
          eta: formatWait(pos.etaMins),
        })
      : t(ctx.language, 'tokenBooked', {
          tokenNumber: pos.tokenNumber,
          date: formatDateForPatient(ctx.today),
          doctorName: ctx.doctor.name,
          nowServing: nowServingLabel(ctx.language, pos.nowServingToken),
          ahead: pos.ahead,
          eta: formatWait(pos.etaMins),
        }),
  );

  return {
    nextStep: Steps.TOKEN_MENU,
    replies: [confirmation],
    data: {},
    // Everyone else's ETA just grew by one consult only if they're behind this
    // token; the worker decides who actually needs telling.
    effects: result.alreadyExisted
      ? []
      : [
          {
            type: 'RECALC_TOKEN_QUEUE',
            doctorId: ctx.doctor.id,
            date: ctx.today,
            originAppointmentId: appointment.id,
          },
        ],
  };
}

async function showStatus(ctx: ConversationContext): Promise<StepResult> {
  const existing = await findActiveToken(ctx.doctor.id, ctx.patient.id, ctx.today);
  if (!existing) {
    return {
      nextStep: Steps.TOKEN_MENU,
      replies: [reply('tokenNoActiveBooking', t(ctx.language, 'tokenNoActiveBooking'))],
      data: {},
    };
  }

  const pos = await computePosition(existing, ctx.doctor);
  return {
    nextStep: Steps.TOKEN_MENU,
    replies: [
      reply(
        'tokenStatus',
        t(ctx.language, 'tokenStatus', {
          tokenNumber: pos.tokenNumber,
          nowServing: nowServingLabel(ctx.language, pos.nowServingToken),
          ahead: pos.ahead,
          eta: formatWait(pos.etaMins),
        }),
      ),
    ],
    data: {},
  };
}

async function startCancel(ctx: ConversationContext): Promise<StepResult> {
  const existing = await findActiveToken(ctx.doctor.id, ctx.patient.id, ctx.today);
  if (!existing) {
    return {
      nextStep: Steps.TOKEN_MENU,
      replies: [reply('tokenNoActiveBooking', t(ctx.language, 'tokenNoActiveBooking'))],
      data: {},
    };
  }

  return {
    nextStep: Steps.TOKEN_CONFIRM_CANCEL,
    data: { appointmentId: existing.id, tokenNumber: existing.tokenNumber },
    replies: [
      reply(
        'tokenCancelConfirm',
        t(ctx.language, 'tokenCancelConfirm', {
          tokenNumber: existing.tokenNumber ?? 0,
          date: formatDateForPatient(ctx.today),
        }),
      ),
    ],
  };
}

async function handleCancelConfirmation(ctx: ConversationContext): Promise<StepResult> {
  if (isNo(ctx.input)) {
    return menuResult(ctx, [reply('tokenCancelAborted', t(ctx.language, 'tokenCancelAborted'))]);
  }

  if (!isYes(ctx.input)) {
    const tokenNumber = Number(ctx.data['tokenNumber'] ?? 0);
    return {
      nextStep: Steps.TOKEN_CONFIRM_CANCEL,
      replies: [
        reply('unknownInput', t(ctx.language, 'unknownInput')),
        reply(
          'tokenCancelConfirm',
          t(ctx.language, 'tokenCancelConfirm', {
            tokenNumber,
            date: formatDateForPatient(ctx.today),
          }),
        ),
      ],
    };
  }

  const appointmentId = typeof ctx.data['appointmentId'] === 'string' ? ctx.data['appointmentId'] : null;
  if (!appointmentId) {
    // Session data lost (expiry, redeploy) — recover instead of erroring.
    return menuResult(ctx, [
      reply('tokenNoActiveBooking', t(ctx.language, 'tokenNoActiveBooking')),
    ]);
  }

  const cancelled = await cancelAppointment(appointmentId, ctx.receivedAt);

  return {
    nextStep: Steps.TOKEN_MENU,
    data: {},
    replies: [
      reply(
        'tokenCancelled',
        t(ctx.language, 'tokenCancelled', { tokenNumber: cancelled.tokenNumber ?? 0 }),
      ),
    ],
    effects: [
      {
        type: 'RECALC_TOKEN_QUEUE',
        doctorId: ctx.doctor.id,
        date: ctx.today,
        originAppointmentId: cancelled.id,
      },
    ],
  };
}
