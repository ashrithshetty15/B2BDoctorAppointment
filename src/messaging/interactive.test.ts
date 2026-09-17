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

const whatsappCloudAdapter = new WhatsAppCloudAdapter();

/**
 * The button contract with Meta, and the property the whole design rests on:
 * a tapped button comes back as its `id`, so ids are the same tokens the typed
 * flow accepts. Tap and type are then indistinguishable to the state machine.
 */

let sentBody: Record<string, unknown>;

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

describe('outbound: text vs interactive', () => {
  it('sends a plain text message when no buttons are supplied', async () => {
    await whatsappCloudAdapter.sendText({ to: '919876543210', text: 'hello' });
    expect(sentBody['type']).toBe('text');
    expect(sentBody['text']).toEqual({ preview_url: false, body: 'hello' });
    expect(sentBody['interactive']).toBeUndefined();
  });

  it('sends interactive buttons when supplied, keeping the text as the body', async () => {
    await whatsappCloudAdapter.sendText({
      to: '919876543210',
      text: '1. Book a token\n2. Check status',
      buttons: [
        { id: '1', title: 'Book a token' },
        { id: '2', title: 'My token status' },
      ],
    });

    expect(sentBody['type']).toBe('interactive');
    const interactive = sentBody['interactive'] as {
      type: string;
      body: { text: string };
      action: { buttons: { type: string; reply: { id: string; title: string } }[] };
    };
    expect(interactive.type).toBe('button');
    // The numbered text survives, so typing still works and the message reads
    // correctly on a client that does not render buttons.
    expect(interactive.body.text).toContain('1. Book a token');
    expect(interactive.action.buttons).toHaveLength(2);
    expect(interactive.action.buttons[0]).toEqual({
      type: 'reply',
      reply: { id: '1', title: 'Book a token' },
    });
  });

  /** Meta rejects a fourth button outright, which would fail the whole send. */
  it('caps at three buttons rather than letting the send fail', async () => {
    await whatsappCloudAdapter.sendText({
      to: '919876543210',
      text: 'menu',
      buttons: [
        { id: '1', title: 'One' },
        { id: '2', title: 'Two' },
        { id: '3', title: 'Three' },
        { id: '4', title: 'Four' },
      ],
    });
    const interactive = sentBody['interactive'] as {
      action: { buttons: { reply: { id: string } }[] };
    };
    expect(interactive.action.buttons).toHaveLength(3);
    expect(interactive.action.buttons.map((b) => b.reply.id)).toEqual(['1', '2', '3']);
  });

  /**
   * A long translation should degrade to a clipped label, not a rejected send.
   * Kannada menu labels run 21-23 characters in full sentence form.
   */
  it('clips an over-long title instead of failing', async () => {
    await whatsappCloudAdapter.sendText({
      to: '919876543210',
      text: 'menu',
      buttons: [{ id: '1', title: 'Book a token for today please' }],
    });
    const interactive = sentBody['interactive'] as {
      action: { buttons: { reply: { title: string } }[] };
    };
    expect(interactive.action.buttons[0]!.reply.title).toHaveLength(20);
  });

  it('falls back to plain text for an empty button list', async () => {
    await whatsappCloudAdapter.sendText({ to: '919876543210', text: 'hi', buttons: [] });
    expect(sentBody['type']).toBe('text');
  });
});

describe('inbound: a tapped button is indistinguishable from typing', () => {
  const envelope = (msg: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '1240078345864841' },
              messages: [{ id: 'wamid.1', from: '919876543210', timestamp: '1700000000', ...msg }],
            },
          },
        ],
      },
    ],
  });

  it('normalises a button tap to the button id', () => {
    const [m] = whatsappCloudAdapter.parseInbound(
      envelope({
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: '1', title: 'Book a token' } },
      }),
    );
    // Identical to what typing "1" produces — which is why no flow needed changing.
    expect(m?.text).toBe('1');
  });

  it('normalises a list row selection to its id', () => {
    const [m] = whatsappCloudAdapter.parseInbound(
      envelope({
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: '3', title: '10:30 AM' } },
      }),
    );
    expect(m?.text).toBe('3');
  });

  it('still accepts a typed number', () => {
    const [m] = whatsappCloudAdapter.parseInbound(
      envelope({ type: 'text', text: { body: ' 1 ' } }),
    );
    expect(m?.text).toBe('1');
  });
});
