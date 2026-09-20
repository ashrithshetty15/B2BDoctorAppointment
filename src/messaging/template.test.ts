import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({
  env: {
    WHATSAPP_API_VERSION: 'v21.0',
    WHATSAPP_ACCESS_TOKEN: 'tok',
    WHATSAPP_PHONE_NUMBER_ID: '1240078345864841',
  } as Record<string, unknown>,
}));
vi.mock('../config/env', () => ({ env }));
vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { WhatsAppCloudAdapter } from './adapters/whatsappCloud';

const adapter = new WhatsAppCloudAdapter();

/**
 * The template contract with Meta.
 *
 * A follow-up is always outside the 24-hour free-form window — weeks outside —
 * so it can only reach the patient as an approved template. That makes this
 * request body the only thing standing between "review in 2 weeks" and the
 * patient never hearing from the clinic again, and until now nothing tested it.
 *
 * It was wrong. Variables were being sent under a `template.body` key, which
 * the Cloud API does not define: they were dropped, and any template with a
 * variable in it would be rejected for supplying none. It survived because the
 * one template in use, clinic_welcome, has no variables.
 */

let sentBody: Record<string, unknown>;

interface Component {
  type: string;
  sub_type?: string;
  index?: string;
  parameters?: { type: string; text?: string; payload?: string }[];
}

const componentsOf = () =>
  ((sentBody['template'] as { components?: Component[] })?.components ?? []) as Component[];

beforeEach(() => {
  sentBody = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      sentBody = JSON.parse(init.body) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: 'wamid.test' }] }),
      };
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('sending an approved template', () => {
  it('puts the variables in components, where Meta reads them', async () => {
    await adapter.sendTemplate({
      to: '919876543210',
      templateName: 'followup_reminder',
      params: ['Asha', 'Ramesh Kumar'],
    });

    expect(componentsOf()).toContainEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Asha' },
        { type: 'text', text: 'Ramesh Kumar' },
      ],
    });
    // The shape that silently dropped them.
    expect(sentBody['template']).not.toHaveProperty('body');
  });

  it('sends no components at all for a template without variables', async () => {
    await adapter.sendTemplate({ to: '919876543210', templateName: 'clinic_welcome' });

    expect(sentBody['template']).not.toHaveProperty('components');
  });

  /**
   * The one-tap button. Its payload is set per send, so one approved template
   * can say which follow-up each reminder is about.
   */
  it('attaches the quick-reply payload to the first button', async () => {
    await adapter.sendTemplate({
      to: '919876543210',
      templateName: 'followup_reminder',
      params: ['Asha', 'Ramesh Kumar'],
      buttonPayload: 'FU:appt-123',
    });

    expect(componentsOf()).toContainEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: 'FU:appt-123' }],
    });
  });

  it('leaves the button out when there is no payload to carry', async () => {
    await adapter.sendTemplate({
      to: '919876543210',
      templateName: 'clinic_welcome',
      params: ['Sunrise Clinic'],
    });

    expect(componentsOf().some((c) => c.type === 'button')).toBe(false);
  });

  /** Approved per language: the wrong code is a refused send, not a translation. */
  it('sends the language the template was approved in', async () => {
    await adapter.sendTemplate({
      to: '919876543210',
      templateName: 'followup_reminder',
      languageCode: 'kn',
    });

    expect((sentBody['template'] as { language: unknown }).language).toEqual({ code: 'kn' });
  });

  it('sends from the clinic that owns the conversation', async () => {
    await adapter.sendTemplate({
      to: '919876543210',
      templateName: 'followup_reminder',
      channelAddress: '999888777',
    });

    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain('/999888777/messages');
  });
});
