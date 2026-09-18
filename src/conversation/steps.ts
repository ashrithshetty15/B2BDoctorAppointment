/**
 * Every step name in one place. Steps are stored as plain strings in
 * conversation_sessions.step so renaming one is a data migration, not a schema
 * change — keep old names working until sessions expire if you rename.
 */
export const Steps = {
  // Shared onboarding
  ENTRY: 'ENTRY',
  AWAITING_LANGUAGE: 'AWAITING_LANGUAGE',
  AWAITING_NAME: 'AWAITING_NAME',

  // TOKEN mode
  TOKEN_MENU: 'TOKEN_MENU',
  TOKEN_CONFIRM_BOOKING: 'TOKEN_CONFIRM_BOOKING',
  TOKEN_CONFIRM_CANCEL: 'TOKEN_CONFIRM_CANCEL',

  // SLOT mode
  SLOT_MENU: 'SLOT_MENU',
  SLOT_AWAITING_DATE: 'SLOT_AWAITING_DATE',
  SLOT_AWAITING_PERIOD: 'SLOT_AWAITING_PERIOD',
  SLOT_AWAITING_TIME: 'SLOT_AWAITING_TIME',
  SLOT_CONFIRM_BOOKING: 'SLOT_CONFIRM_BOOKING',
  SLOT_CONFIRM_CANCEL: 'SLOT_CONFIRM_CANCEL',

  // HYBRID mode
  HYBRID_AWAITING_MODE: 'HYBRID_AWAITING_MODE',
} as const;

export type Step = (typeof Steps)[keyof typeof Steps];
