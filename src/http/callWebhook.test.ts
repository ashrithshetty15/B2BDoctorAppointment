import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({
  env: {
    EXOTEL_WEBHOOK_TOKEN: 'secret-token',
    EXOTEL_WELCOME_TEMPLATE: 'clinic_welcome',
  } as Record<string, unknown>,
}));

const clinicFindUnique = vi.fn();
const doctorFindUnique = vi.fn();
const patientFindUnique = vi.fn();
const patientCreate = vi.fn();
const processedFindUnique = vi.fn();
const processedCreate = vi.fn();
const sendTemplate = vi.fn();

vi.mock('../config/env', () => ({ env }));
vi.mock('../db/prisma', () => ({
  prisma: {
    clinic: { findUnique: (...a: unknown[]) => clinicFindUnique(...a) },
    doctor: { findUnique: (...a: unknown[]) => doctorFindUnique(...a) },
    patient: {
      findUnique: (...a: unknown[]) => patientFindUnique(...a),
      create: (...a: unknown[]) => patientCreate(...a),
    },
    processedMessage: {
      findUnique: (...a: unknown[]) => processedFindUnique(...a),
      create: (...a: unknown[]) => processedCreate(...a),
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

/** Drives the router's handler directly — no server, no supertest. */
async function call(
  method: 'get' | 'post',
  params: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const layer = (callWebhookRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Function }[] } }[] }).stack
    .map((l) => l.route)
    .find((r) => r?.path === '/call-webhook' && r.methods[method]);

  if (!layer) throw new Error(`no ${method.toUpperCase()} route registered`);

  const req = method === 'get' ? { query: params, body: {} } : { query: {}, body: params };

  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  };

  await layer.stack[0]!.handle(req, res, () => undefined);
  return { status, body };
}

const VALID = {
  token: 'secret-token',
  CallSid: 'call-1',
  CallFrom: '+91 98765 43210',
  CallTo: '+918130819820',
};

beforeEach(() => {
  env['EXOTEL_WEBHOOK_TOKEN'] = 'secret-token';
  clinicFindUnique.mockReset().mockResolvedValue({
    id: 'clinic-1',
    name: 'Dentin Clinic',
    whatsappPhoneNumberId: 'pn-1',
  });
  doctorFindUnique.mockReset().mockResolvedValue(null);
  patientFindUnique.mockReset().mockResolvedValue({ id: 'pat-1' });
  patientCreate.mockReset().mockResolvedValue({ id: 'pat-new' });
  processedFindUnique.mockReset().mockResolvedValue(null);
  processedCreate.mockReset().mockResolvedValue({});
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

    expect(clinicFindUnique).toHaveBeenCalledWith({
      where: { missedCallNumber: '918130819820' },
    });
  });

  it('messages the caller, digits only', async () => {
    await call('get', VALID);

    expect(sendTemplate.mock.calls[0]![0]).toMatchObject({
      to: '919876543210',
      templateName: 'clinic_welcome',
      params: ['Dentin Clinic'],
      channelAddress: 'pn-1',
    });
  });

  /** Numbers configured before clinics existed still work. */
  it('falls back to a doctor when no clinic holds the number', async () => {
    clinicFindUnique.mockResolvedValue(null);
    doctorFindUnique.mockResolvedValue({
      clinicId: 'clinic-9',
      clinicName: 'Sunrise Clinic',
      whatsappPhoneNumberId: 'pn-9',
    });

    const res = await call('get', VALID);

    expect(res.status).toBe(200);
    expect(sendTemplate.mock.calls[0]![0]).toMatchObject({ params: ['Sunrise Clinic'] });
  });

  it('404s an unknown number without messaging anyone', async () => {
    clinicFindUnique.mockResolvedValue(null);
    doctorFindUnique.mockResolvedValue(null);

    const res = await call('get', VALID);

    expect(res.status).toBe(404);
    expect(sendTemplate).not.toHaveBeenCalled();
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

describe('repeated deliveries', () => {
  it('sends once for a call it has already handled', async () => {
    processedFindUnique.mockResolvedValue({ providerMessageId: 'call-1' });

    const res = await call('get', VALID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  /** Only a successful send is recorded, so a failure is retried rather than lost. */
  it('records nothing when the send fails', async () => {
    sendTemplate.mockRejectedValue(new Error('132000 parameter mismatch'));

    const res = await call('get', VALID);

    expect(res.status).toBe(500);
    expect(processedCreate).not.toHaveBeenCalled();
  });
});
