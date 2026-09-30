import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({
  env: {
    EXOTEL_WEBHOOK_TOKEN: 'secret-token',
    EXOTEL_WELCOME_TEMPLATE: 'clinic_welcome',
  } as Record<string, unknown>,
}));

const clinicFindUnique = vi.fn();
const clinicFindFirst = vi.fn();
const doctorFindUnique = vi.fn();
const doctorFindFirst = vi.fn();
const patientFindUnique = vi.fn();
const patientCreate = vi.fn();
const processedFindUnique = vi.fn();
const processedCreate = vi.fn();
const processedDelete = vi.fn();
const sendTemplate = vi.fn();

vi.mock('../config/env', () => ({ env }));
vi.mock('../db/prisma', () => ({
  prisma: {
    clinic: {
      findUnique: (...a: unknown[]) => clinicFindUnique(...a),
      findFirst: (...a: unknown[]) => clinicFindFirst(...a),
    },
    doctor: {
      findUnique: (...a: unknown[]) => doctorFindUnique(...a),
      findFirst: (...a: unknown[]) => doctorFindFirst(...a),
    },
    patient: {
      findUnique: (...a: unknown[]) => patientFindUnique(...a),
      create: (...a: unknown[]) => patientCreate(...a),
    },
    processedMessage: {
      findUnique: (...a: unknown[]) => processedFindUnique(...a),
      create: (...a: unknown[]) => processedCreate(...a),
      delete: (...a: unknown[]) => processedDelete(...a),
    },
  },
}));
vi.mock('../messaging', () => ({
  getMessagingAdapter: () => ({
    name: 'test',
    sendTemplate: (...a: unknown[]) => sendTemplate(...a),
  }),
}));
vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { callWebhookRouter } from './call-webhook';

/**
 * The missed-call trigger, which had no tests at all.
 *
 * Two things it must get right, and both were wrong: Exotel's Passthru sends a
 * GET with query parameters, and this route accepted only POST with a body —
 * so a correctly configured applet hit a 404 and nothing happened. And the
 * endpoint was unauthenticated, while being able to send a WhatsApp template to
 * any number a caller names.
 */

/**
 * Drives the router's handlers directly — no server, no supertest.
 *
 * The whole chain is run, not just the final handler: the route is now
 * `requireExotelToken -> missedCallLimiter -> handleMissedCall`, and running
 * only the last of those would test the one layer that assumes the other two
 * already passed. Each handler runs until one responds without calling next().
 */
async function call(
  method: 'get' | 'post',
  params: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const layer = (
    callWebhookRouter as unknown as {
      stack: {
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: { handle: Function }[];
        };
      }[];
    }
  ).stack
    .map((l) => l.route)
    .find((r) => r?.path === '/call-webhook' && r.methods[method]);

  if (!layer) throw new Error(`no ${method.toUpperCase()} route registered`);

  const req = method === 'get' ? { query: params, body: {} } : { query: {}, body: params };

  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    set(name: string, value: string) {
      headers[name] = value;
      return res;
    },
  };

  for (const handler of layer.stack) {
    let advanced = false;
    await handler.handle(req, res, () => {
      advanced = true;
    });
    if (!advanced) break;
  }

  return { status, body };
}

/**
 * A fresh caller and call id per test.
 *
 * The rate limiter holds its buckets in module scope, so a fixed CallFrom would
 * carry counts from one test into the next and the sixth test to run would get
 * a 429 for reasons that have nothing to do with what it asserts.
 */
let seq = 0;
let VALID: Record<string, string>;

beforeEach(() => {
  seq += 1;
  VALID = {
    token: 'secret-token',
    CallSid: `call-${seq}`,
    CallFrom: `+91 98765 ${String(10000 + seq).slice(0, 5)}`,
    CallTo: '+918130819820',
  };

  env['EXOTEL_WEBHOOK_TOKEN'] = 'secret-token';
  clinicFindFirst.mockReset().mockResolvedValue({
    id: 'clinic-1',
    name: 'Dentin Clinic',
    whatsappPhoneNumberId: 'pn-1',
  });
  doctorFindFirst.mockReset().mockResolvedValue(null);
  patientFindUnique.mockReset().mockResolvedValue({ id: 'pat-1' });
  patientCreate.mockReset().mockResolvedValue({ id: 'pat-new' });
  processedFindUnique.mockReset().mockResolvedValue(null);
  // Claiming the CallSid succeeds by default; a duplicate delivery is modelled
  // by making this reject, which is what the unique constraint does.
  processedCreate.mockReset().mockResolvedValue({});
  processedDelete.mockReset().mockResolvedValue({});
  sendTemplate.mockReset().mockResolvedValue({ providerMessageId: 'wamid.1' });
});

describe('the method Exotel actually uses', () => {
  /** The bug: Passthru GETs, and this route was POST-only. */
  it('accepts a GET with query parameters', async () => {
    const res = await call('get', VALID);

    expect(res.status).toBe(200);
    expect(sendTemplate).toHaveBeenCalledOnce();
  });

  it('still accepts a POST body', async () => {
    const res = await call('post', VALID);

    expect(res.status).toBe(200);
    expect(sendTemplate).toHaveBeenCalledOnce();
  });
});

describe('who is allowed to trigger it', () => {
  it('refuses a request with no token', async () => {
    const { token, ...withoutToken } = VALID;
    void token;

    const res = await call('get', withoutToken);

    expect(res.status).toBe(401);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('refuses a wrong token', async () => {
    const res = await call('get', { ...VALID, token: 'guessed' });

    expect(res.status).toBe(401);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  /** Fails closed: unconfigured must not mean open. */
  it('refuses everything when no token is configured at all', async () => {
    env['EXOTEL_WEBHOOK_TOKEN'] = undefined;

    const res = await call('get', VALID);

    expect(res.status).toBe(503);
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});

describe('resolving the clinic', () => {
  it('strips punctuation before matching the number', async () => {
    await call('get', VALID);

    const where = clinicFindFirst.mock.calls[0]![0].where;
    expect(where.missedCallNumber.in).toContain('918130819820');
  });

  it('messages the caller, digits only', async () => {
    await call('get', { ...VALID, CallFrom: '+91 98765 43210' });

    expect(sendTemplate.mock.calls[0]![0]).toMatchObject({
      to: '919876543210',
      templateName: 'clinic_welcome',
      params: ['Dentin Clinic'],
      channelAddress: 'pn-1',
    });
  });

  /** Numbers configured before clinics existed still work. */
  it('falls back to a doctor when no clinic holds the number', async () => {
    clinicFindFirst.mockResolvedValue(null);
    doctorFindFirst.mockResolvedValue({
      clinicId: 'clinic-9',
      clinicName: 'Sunrise Clinic',
      whatsappPhoneNumberId: 'pn-9',
    });

    const res = await call('get', VALID);

    expect(res.status).toBe(200);
    expect(sendTemplate.mock.calls[0]![0]).toMatchObject({ params: ['Sunrise Clinic'] });
  });

  it('404s an unknown number without messaging anyone', async () => {
    clinicFindFirst.mockResolvedValue(null);
    doctorFindFirst.mockResolvedValue(null);

    const res = await call('get', VALID);

    expect(res.status).toBe(404);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  /**
   * The one that matters once there is more than one customer.
   *
   * CallTo is the ExoPhone the patient dialled, which is the whole reason a
   * single shared webhook can serve every clinic: each clinic forwards its own
   * advertised number to its own ExoPhone, so the dialled number identifies the
   * practice unambiguously. Each must answer as itself, from its own sender.
   *
   * This is also the shape of the bug that was live in production: every clinic
   * row had a null missed_call_number, so this lookup found nothing and every
   * genuine call fell through to the 404 above.
   */
  it('routes two clinics to their own numbers and their own senders', async () => {
    const CLINICS: Record<string, { id: string; name: string; whatsappPhoneNumberId: string }> = {
      '918130819820': { id: 'c-dentin', name: 'Dentin Clinic', whatsappPhoneNumberId: 'pn-dentin' },
      '918130819821': { id: 'c-jalaja', name: 'Jalaja Skin Care', whatsappPhoneNumberId: 'pn-jalaja' },
    };
    // Stands in for the unique index: the first stored number that appears in
    // the candidate set wins, and at most one can.
    clinicFindFirst.mockImplementation(
      ({ where }: { where: { missedCallNumber: { in: string[] } } }) =>
        Promise.resolve(
          Object.entries(CLINICS).find(([stored]) =>
            where.missedCallNumber.in.includes(stored),
          )?.[1] ?? null,
        ),
    );

    await call('get', { ...VALID, CallTo: '918130819820', CallSid: 'a', CallFrom: '919000001111' });
    await call('get', { ...VALID, CallTo: '918130819821', CallSid: 'b', CallFrom: '919000002222' });

    expect(sendTemplate.mock.calls[0]![0]).toMatchObject({
      to: '919000001111',
      params: ['Dentin Clinic'],
      channelAddress: 'pn-dentin',
    });
    expect(sendTemplate.mock.calls[1]![0]).toMatchObject({
      to: '919000002222',
      params: ['Jalaja Skin Care'],
      channelAddress: 'pn-jalaja',
    });
  });

  /**
   * The trap this nearly fell into with Jalaja's real ExoPhone, 08047288908.
   *
   * Exotel reports CallTo as the carrier hands it, so the same number arrives
   * with a trunk zero on one call and a country code on another. An equality
   * match against whatever an operator typed into the console would authenticate
   * the call, find nothing, and return 404 — indistinguishable from a clinic
   * that was never configured, and completely silent to the patient.
   */
  describe('the same ExoPhone written different ways', () => {
    const STORED = '918047288908';
    const asStored = (stored: string) =>
      clinicFindFirst.mockImplementation(
        ({ where }: { where: { missedCallNumber: { in: string[] } } }) =>
          Promise.resolve(
            where.missedCallNumber.in.includes(stored)
              ? { id: 'c-jalaja', name: 'Jalaja Skin Care', whatsappPhoneNumberId: 'pn-jalaja' }
              : null,
          ),
      );

    it.each(['08047288908', '8047288908', '+91 80 4728 8908', '918047288908'])(
      'reaches a clinic stored as 918047288908 when Exotel says %s',
      async (reported) => {
        asStored(STORED);

        const res = await call('get', { ...VALID, CallTo: reported });

        expect(res.status).toBe(200);
        expect(sendTemplate.mock.calls[0]![0]).toMatchObject({ params: ['Jalaja Skin Care'] });
      },
    );

    /** And the reverse: stored with a trunk zero, reported with a country code. */
    it('reaches a clinic stored as 08047288908 when Exotel says +918047288908', async () => {
      asStored('08047288908');

      const res = await call('get', { ...VALID, CallTo: '+918047288908' });

      expect(res.status).toBe(200);
      expect(sendTemplate).toHaveBeenCalledOnce();
    });

    it('still refuses a genuinely different number', async () => {
      asStored(STORED);

      const res = await call('get', { ...VALID, CallTo: '919731028452' });

      expect(res.status).toBe(404);
      expect(sendTemplate).not.toHaveBeenCalled();
    });
  });
});

describe('malformed events', () => {
  /**
   * A missing CallTo used to reach Prisma as undefined, throw, and surface as a
   * 500 — which reads like an outage rather than a misconfigured applet.
   */
  it.each(['CallSid', 'CallFrom', 'CallTo'])('400s when %s is missing', async (missing) => {
    const params = { ...VALID } as Record<string, string>;
    delete params[missing];

    const res = await call('get', params);

    expect(res.status).toBe(400);
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  /** Status and Direction are sent by Exotel and deliberately ignored. */
  it('does not care what the call status says', async () => {
    const res = await call('get', { ...VALID, Status: 'failed', Direction: 'outbound' });

    expect(res.status).toBe(200);
    expect(sendTemplate).toHaveBeenCalledOnce();
  });
});

/**
 * Deduplication is a claim, not a check.
 *
 * Reading first and writing after the send left a window where two deliveries
 * of one CallSid both saw no row and both sent — the patient got the welcome
 * twice and the clinic paid twice. The insert is now the claim, so the unique
 * constraint decides the winner, and it is released again if the send fails so
 * Exotel's retry still works.
 */
describe('repeated deliveries', () => {
  it('claims the call before sending, not after', async () => {
    await call('get', VALID);

    const createOrder = processedCreate.mock.invocationCallOrder[0]!;
    const sendOrder = sendTemplate.mock.invocationCallOrder[0]!;
    expect(createOrder).toBeLessThan(sendOrder);
  });

  it('sends once for a call it has already handled', async () => {
    processedCreate.mockRejectedValue(new Error('Unique constraint failed'));

    const res = await call('get', VALID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  /** A failed send must not leave the call looking handled. */
  it('releases the claim when the send fails', async () => {
    sendTemplate.mockRejectedValue(new Error('132000 parameter mismatch'));

    const res = await call('get', VALID);

    expect(res.status).toBe(500);
    expect(processedDelete).toHaveBeenCalledWith({
      where: { providerMessageId: VALID['CallSid'] },
    });
  });

  it('releases the claim when the number belongs to no clinic', async () => {
    clinicFindFirst.mockResolvedValue(null);
    doctorFindFirst.mockResolvedValue(null);

    await call('get', VALID);

    expect(processedDelete).toHaveBeenCalledWith({
      where: { providerMessageId: VALID['CallSid'] },
    });
  });

  it('keeps the claim once the send has landed', async () => {
    await call('get', VALID);

    expect(processedDelete).not.toHaveBeenCalled();
  });
});

/**
 * One caller, a handful of replies an hour.
 *
 * Each distinct CallSid sends a template and each template costs the clinic
 * money, so a number redialling in a loop is a bill. Keyed on the caller rather
 * than the IP: every request here comes from Exotel, and an IP bucket would
 * count every clinic's patients together.
 */
describe('a caller who will not stop redialling', () => {
  it('stops replying past the hourly ceiling', async () => {
    const caller = '919000000001';
    const results = [];
    for (let i = 0; i < 7; i += 1) {
      results.push(await call('get', { ...VALID, CallFrom: caller, CallSid: `loop-${i}` }));
    }

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    expect(sendTemplate).toHaveBeenCalledTimes(5);
  });

  it('counts each caller separately, so one loop cannot mute another patient', async () => {
    for (let i = 0; i < 6; i += 1) {
      await call('get', { ...VALID, CallFrom: '919000000002', CallSid: `noisy-${i}` });
    }
    sendTemplate.mockClear();

    const quiet = await call('get', {
      ...VALID,
      CallFrom: '919000000003',
      CallSid: 'quiet-1',
    });

    expect(quiet.status).toBe(200);
    expect(sendTemplate).toHaveBeenCalledOnce();
  });

  /** Authentication runs first, so a flood of bad tokens cannot spend a real
   *  patient's budget and lock them out of the clinic. */
  it('does not let unauthenticated requests consume a caller\'s budget', async () => {
    const caller = '919000000004';
    for (let i = 0; i < 6; i += 1) {
      await call('get', { ...VALID, token: 'wrong', CallFrom: caller, CallSid: `bad-${i}` });
    }

    const real = await call('get', { ...VALID, CallFrom: caller, CallSid: 'real-1' });

    expect(real.status).toBe(200);
    expect(sendTemplate).toHaveBeenCalledOnce();
  });
});
