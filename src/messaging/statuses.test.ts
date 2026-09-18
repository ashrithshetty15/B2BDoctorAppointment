import { describe, expect, it } from 'vitest';
import { WhatsAppCloudAdapter } from './adapters/whatsappCloud';

const adapter = new WhatsAppCloudAdapter();

/**
 * Delivery receipts are the only place an undelivered message is visible. The
 * send API returned a real message id for a message that never arrived — from
 * the API's answer alone, that is indistinguishable from success.
 */

const wrap = (value: unknown) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '4556910234554572', changes: [{ field: 'messages', value }] }],
});

const FAILED = wrap({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '919731028452', phone_number_id: '1404728522723325' },
  statuses: [
    {
      id: 'wamid.HBgMOTE5NjExMjM0NzY1',
      status: 'failed',
      timestamp: '1789726568',
      recipient_id: '919611234765',
      errors: [
        {
          code: 131049,
          title: 'This message was not delivered to maintain healthy ecosystem engagement.',
          error_data: { details: 'Message failed to send because of a quality policy.' },
        },
      ],
    },
  ],
});

describe('parseStatuses', () => {
  it('reports a failed delivery with the provider code and the recipient', () => {
    const [s] = adapter.parseStatuses(FAILED);

    expect(s?.status).toBe('failed');
    expect(s?.providerMessageId).toBe('wamid.HBgMOTE5NjExMjM0NzY1');
    expect(s?.recipient).toBe('919611234765');
    expect(s?.channelAddress).toBe('1404728522723325');
    expect(s?.errors?.[0]?.code).toBe(131049);
  });

  /** Meta leaves `title` generic and puts the useful sentence in error_data. */
  it('prefers error_data.details over the generic title', () => {
    const [s] = adapter.parseStatuses(FAILED);
    expect(s?.errors?.[0]?.details).toContain('quality policy');
  });

  it('reads the ordinary progression without inventing errors', () => {
    for (const status of ['sent', 'delivered', 'read']) {
      const [s] = adapter.parseStatuses(
        wrap({ metadata: { phone_number_id: '1' }, statuses: [{ id: 'wamid.X', status }] }),
      );
      expect(s?.status).toBe(status);
      expect(s?.errors).toBeUndefined();
    }
  });

  it('returns nothing for a payload carrying messages rather than receipts', () => {
    const inbound = wrap({
      metadata: { phone_number_id: '1' },
      messages: [{ id: 'wamid.Y', from: '919611234765', type: 'text', text: { body: 'hi' } }],
    });
    expect(adapter.parseStatuses(inbound)).toEqual([]);
  });

  it('ignores anything that is not a WhatsApp payload', () => {
    expect(adapter.parseStatuses({ object: 'page' })).toEqual([]);
    expect(adapter.parseStatuses(undefined)).toEqual([]);
    expect(adapter.parseStatuses({})).toEqual([]);
  });

  it('skips a receipt with no id or no status rather than emitting a blank one', () => {
    const out = adapter.parseStatuses(
      wrap({
        metadata: { phone_number_id: '1' },
        statuses: [{ status: 'failed' }, { id: 'wamid.Z' }, { id: 'wamid.W', status: 'sent' }],
      }),
    );
    expect(out.map((s) => s.providerMessageId)).toEqual(['wamid.W']);
  });

  /** A receipt and a message can share one payload; neither may hide the other. */
  it('reads receipts from a payload that also carries a message', () => {
    const both = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'w',
          changes: [
            { field: 'messages', value: { metadata: { phone_number_id: '1' }, statuses: [{ id: 'a', status: 'failed' }] } },
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '1' },
                messages: [{ id: 'b', from: '91', type: 'text', text: { body: 'hi' } }],
              },
            },
          ],
        },
      ],
    };
    expect(adapter.parseStatuses(both)).toHaveLength(1);
    expect(adapter.parseInbound(both)).toHaveLength(1);
  });
});
