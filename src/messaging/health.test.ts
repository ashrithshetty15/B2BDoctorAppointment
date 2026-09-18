import { describe, expect, it } from 'vitest';
import { parseChannelHealth } from './health';

/**
 * Fixtures captured from the live account on 18 Sep, during the outage this
 * feature exists to prevent. Real payloads rather than invented ones, because
 * the traps here are exactly the details a hand-written mock would smooth over.
 */

/** The number was silently rejecting every reply. Cause: unpaid WABA. */
const BLOCKED_ON_PAYMENT = {
  health_status: {
    can_send_message: 'BLOCKED',
    entities: [
      {
        entity_type: 'PHONE_NUMBER',
        id: '1404728522723325',
        can_send_message: 'LIMITED',
        can_receive_call_sip: 'BLOCKED',
        errors: [
          {
            error_code: 138024,
            error_description: 'WhatsApp Business calling cannot use SIP because it is not enabled',
            possible_solution: 'Configure SIP using {PHONE_NUMBER_ID}/settings API',
          },
        ],
        additional_info: [
          'Your display name has not been approved yet. Your message limit will increase after the display name is approved.',
        ],
      },
      {
        entity_type: 'WABA',
        id: '4556910234554572',
        can_send_message: 'BLOCKED',
        errors: [
          {
            error_code: 141006,
            error_description:
              'There is an error with the payment method. This will block business initiated conversations.',
            possible_solution:
              'There was an error with your payment method. Please add a new payment method to the account.',
          },
        ],
      },
      { entity_type: 'BUSINESS', id: '1369647215238268', can_send_message: 'AVAILABLE' },
      {
        entity_type: 'APP',
        id: '1099990606043663',
        can_send_message: 'AVAILABLE',
        errors: [
          {
            error_code: 138025,
            error_description: 'This app cannot use SIP for WhatsApp Business calling...',
          },
        ],
      },
    ],
  },
};

/** The same number minutes later, after the payment method was added. */
const HEALTHY_BUT_PENDING_NAME = {
  health_status: {
    can_send_message: 'LIMITED',
    entities: [
      {
        entity_type: 'PHONE_NUMBER',
        can_send_message: 'LIMITED',
        additional_info: ['Your display name has not been approved yet.'],
      },
      { entity_type: 'WABA', can_send_message: 'AVAILABLE' },
      { entity_type: 'BUSINESS', can_send_message: 'AVAILABLE' },
      { entity_type: 'APP', can_send_message: 'AVAILABLE' },
    ],
  },
};

describe('parseChannelHealth', () => {
  /**
   * The trap that cost hours: the *number* reported only LIMITED. Reading the
   * rollup alone gives "BLOCKED" with no cause; the actionable sentence lives on
   * the WABA entity, one level up.
   */
  it('surfaces the blocking account error, not the number it rolls up to', () => {
    const h = parseChannelHealth(BLOCKED_ON_PAYMENT);
    expect(h.status).toBe('BLOCKED');
    expect(h.entity).toBe('WABA');
    expect(h.code).toBe(141006);
    expect(h.reason).toContain('payment method');
    expect(h.solution).toContain('add a new payment method');
  });

  /**
   * 138024/138025 are "SIP not configured for WhatsApp Business calling" and
   * appear on healthy numbers. Showing them marks every clinic broken and
   * teaches everyone to ignore the indicator.
   */
  it('never reports the WhatsApp-calling SIP errors as the fault', () => {
    const h = parseChannelHealth(BLOCKED_ON_PAYMENT);
    expect(h.code).not.toBe(138024);
    expect(h.code).not.toBe(138025);
    expect(h.reason).not.toContain('SIP');
  });

  it('falls back to advisory text when an entity has no real error code', () => {
    const h = parseChannelHealth(HEALTHY_BUT_PENDING_NAME);
    expect(h.status).toBe('LIMITED');
    expect(h.entity).toBe('PHONE_NUMBER');
    expect(h.reason).toContain('display name');
    expect(h.code).toBeUndefined();
  });

  it('reports a fully healthy channel with nothing to explain', () => {
    const h = parseChannelHealth({
      health_status: {
        can_send_message: 'AVAILABLE',
        entities: [
          { entity_type: 'PHONE_NUMBER', can_send_message: 'AVAILABLE' },
          { entity_type: 'WABA', can_send_message: 'AVAILABLE' },
        ],
      },
    });
    expect(h.status).toBe('AVAILABLE');
    expect(h.reason).toBeUndefined();
  });

  /** An entity with only ignorable errors must not be picked as the fault. */
  it('ignores an entity whose only errors are the calling ones', () => {
    const h = parseChannelHealth({
      health_status: {
        can_send_message: 'LIMITED',
        entities: [
          {
            entity_type: 'PHONE_NUMBER',
            can_send_message: 'LIMITED',
            errors: [{ error_code: 138024, error_description: 'SIP not enabled' }],
          },
        ],
      },
    });
    expect(h.code).toBeUndefined();
    expect(h.reason).toBeUndefined();
    // Still reports the degraded status — we just cannot say why.
    expect(h.status).toBe('LIMITED');
  });

  it('is UNKNOWN rather than falsely healthy when the field is missing', () => {
    expect(parseChannelHealth({}).status).toBe('UNKNOWN');
    expect(parseChannelHealth(undefined).status).toBe('UNKNOWN');
    expect(parseChannelHealth({ health_status: {} }).status).toBe('UNKNOWN');
  });

  it('does not invent a status it does not recognise', () => {
    const h = parseChannelHealth({ health_status: { can_send_message: 'SOMETHING_NEW' } });
    expect(h.status).toBe('UNKNOWN');
  });

  /** An account fault matters more than a number fault when both are degraded. */
  it('prefers the account-level fault over the number-level one', () => {
    const h = parseChannelHealth({
      health_status: {
        can_send_message: 'BLOCKED',
        entities: [
          {
            entity_type: 'PHONE_NUMBER',
            can_send_message: 'BLOCKED',
            errors: [{ error_code: 1, error_description: 'number problem' }],
          },
          {
            entity_type: 'WABA',
            can_send_message: 'BLOCKED',
            errors: [{ error_code: 2, error_description: 'account problem' }],
          },
        ],
      },
    });
    expect(h.entity).toBe('WABA');
    expect(h.reason).toBe('account problem');
  });
});
