import crypto from 'node:crypto';
import { type NextFunction, Request, Response, Router } from 'express';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { dialledNumberCandidates } from '../domain/phone';
import { logger } from '../utils/logger';
import { getMessagingAdapter } from '../messaging';
import type { TemplateMessage } from '../messaging/types';
import { createRateLimiter } from './middleware/rateLimit';

/**
 * Missed-call trigger. A patient rings the clinic's Exotel number, the call is
 * hung up without connecting, and they get a WhatsApp message seconds later —
 * which is the whole point: a missed call is the one action every patient in
 * India already knows how to perform, and it costs them nothing.
 *
 * Exotel's Passthru applet calls this with a **GET**, the call details appended
 * as query parameters. This route was POST-only and read req.body, so a
 * correctly configured Passthru hit Express's catch-all 404 and nothing
 * happened at all. Both methods are accepted now: GET is what Exotel sends,
 * POST is what the Postman collection and any retry tooling already use.
 */

export const callWebhookRouter = Router();

/**
 * What Exotel sends:
 * - CallSid   unique call identifier, and our dedupe key
 * - CallFrom  the caller's number — the patient we message
 * - CallTo    the ExoPhone that was dialled — identifies the clinic
 * - Direction / CurrentTime / Status — sent, never read. Any call event on this
 *   flow is a missed-call trigger; the flow hangs up immediately after.
 */
function field(req: Request, name: string): string {
  const raw = (req.query?.[name] ?? (req.body as Record<string, unknown> | undefined)?.[name]) as
    | string
    | undefined;
  return typeof raw === 'string' ? raw.trim() : '';
}

const digits = (value: string) => value.replace(/\D/g, '');

/**
 * Constant-time secret comparison.
 *
 * timingSafeEqual throws on a length mismatch, which would itself leak the
 * secret's length, so both sides are hashed to a fixed 32 bytes first.
 */
function secretsMatch(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * One caller, one clinic reply, a few times an hour.
 *
 * Every distinct CallSid sends a WhatsApp template, and a template costs the
 * clinic money. The CallSid dedupe stops Exotel's retries of the *same* call
 * but does nothing about someone redialling in a loop, so without this a single
 * number could run up a bill from the clinic's own sender.
 *
 * Keyed on the caller, not the IP: every request here comes from Exotel, so an
 * IP bucket would count all clinics together.
 *
 * Honest about its limits — it is per-process and resets on deploy, so it
 * blunts a runaway dialler rather than guaranteeing a spend ceiling. A hard cap
 * would need a counter in Postgres or Redis.
 */
const missedCallLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyOf: (req) => digits(field(req, 'CallFrom')),
});

/**
 * Who owns this number.
 *
 * Clinic first, because a missed call knows which *number* was dialled and not
 * which doctor — and one number per doctor is the trap that made a five-doctor
 * practice eat a quarter of a WABA. Resolving the clinic lets the bot ask which
 * doctor, exactly as it does for a patient who messages in. The doctor lookup
 * stays as a fallback for numbers configured before this existed.
 */
async function clinicForMissedCall(callTo: string) {
  // Every form the same ExoPhone might be written in. Exotel reports CallTo as
  // the carrier hands it — "08047288908" or "+918047288908" for one number — so
  // an equality match against whatever an operator happened to type would fail
  // silently and look exactly like an unconfigured clinic.
  //
  // findFirst rather than findUnique: `in` is not a unique-where input. The
  // column is still unique, so at most one row can match.
  const candidates = dialledNumberCandidates(callTo);

  const clinic = await prisma.clinic.findFirst({
    where: { missedCallNumber: { in: candidates } },
  });
  if (clinic) {
    return {
      clinicId: clinic.id,
      clinicName: clinic.name,
      channelAddress: clinic.whatsappPhoneNumberId ?? undefined,
    };
  }

  const doctor = await prisma.doctor.findFirst({
    where: { missedCallNumber: { in: candidates } },
  });
  if (doctor) {
    return {
      clinicId: doctor.clinicId ?? undefined,
      clinicName: doctor.clinicName,
      channelAddress: doctor.whatsappPhoneNumberId ?? undefined,
    };
  }

  return null;
}

/**
 * The only thing standing between this URL and anyone on the internet.
 *
 * There was no authentication of any kind. Anyone who learned a clinic's
 * missed-call number could call this with any CallFrom they liked and have us
 * send a template to a stranger — from the clinic's own number, at the clinic's
 * cost, against the clinic's sender reputation. Exotel passes arbitrary query
 * parameters through untouched, so a shared secret in the URL is both the
 * smallest fix and the one Exotel can actually carry.
 *
 * Fails closed: with no token configured the endpoint refuses everything rather
 * than quietly reverting to open.
 *
 * Its own middleware so that it runs *before* the rate limiter. The other way
 * round, an unauthenticated flood could spend a real patient's hourly budget
 * and lock them out of the clinic they were trying to reach.
 */
function requireExotelToken(req: Request, res: Response, next: NextFunction): void {
  if (!env.EXOTEL_WEBHOOK_TOKEN) {
    logger.error('Missed-call webhook hit but EXOTEL_WEBHOOK_TOKEN is not set; refusing');
    res.status(503).json({ error: 'Not configured' });
    return;
  }
  if (!secretsMatch(field(req, 'token'), env.EXOTEL_WEBHOOK_TOKEN)) {
    logger.warn('Rejected missed-call webhook: bad or missing token');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

async function handleMissedCall(req: Request, res: Response): Promise<void> {
  const callSid = field(req, 'CallSid');
  const callFrom = digits(field(req, 'CallFrom'));
  const callTo = digits(field(req, 'CallTo'));

  // CallTo is validated here rather than left to the lookup: a Prisma
  // findUnique on undefined throws, which surfaced as a 500 and read like an
  // outage instead of a misconfigured applet.
  if (!callSid || !callFrom || !callTo) {
    logger.warn(
      { hasCallSid: Boolean(callSid), hasCallFrom: Boolean(callFrom), hasCallTo: Boolean(callTo) },
      'Incomplete Exotel call event',
    );
    res.status(400).json({ error: 'Missing CallSid, CallFrom or CallTo' });
    return;
  }

  /**
   * Claim the call before sending, not after.
   *
   * Reading first and writing after the send left a window: two deliveries of
   * the same CallSid arriving together both saw no row, and both sent — the
   * patient got the welcome message twice and the clinic paid for both. The
   * insert is atomic on the primary key, so exactly one delivery can win it.
   *
   * The row is removed again if the send fails, which preserves the original
   * intent: a transient failure is retried by Exotel rather than being
   * swallowed as "already handled".
   */
  try {
    await prisma.processedMessage.create({ data: { providerMessageId: callSid } });
  } catch {
    logger.debug({ callSid }, 'Duplicate call event, ignoring');
    res.json({ ok: true });
    return;
  }

  let claimed = true;
  const releaseClaim = async () => {
    if (!claimed) return;
    claimed = false;
    await prisma.processedMessage
      .delete({ where: { providerMessageId: callSid } })
      .catch(() => null);
  };

  try {
    const clinic = await clinicForMissedCall(callTo);
    if (!clinic) {
      // Both the raw value and every form tried are logged deliberately: this
      // is the one branch where a formatting mismatch and a genuinely
      // unconfigured number look identical, so configuring a new clinic is a
      // matter of reading these back rather than guessing.
      logger.warn(
        { callTo, tried: dialledNumberCandidates(callTo) },
        'No clinic found for missed-call number',
      );
      await releaseClaim();
      res.status(404).json({ error: 'No clinic for this number' });
      return;
    }

    let patient = await prisma.patient.findUnique({ where: { phone: callFrom } });
    if (!patient) {
      patient = await prisma.patient.create({ data: { phone: callFrom, language: 'EN' } });
      logger.debug({ patientId: patient.id }, 'Created patient from missed call');
    }

    const adapter = getMessagingAdapter();
    if (!adapter.sendTemplate) {
      logger.error({ adapter: adapter.name }, 'Adapter does not support templates');
      await releaseClaim();
      res.status(500).json({ error: 'Messaging adapter does not support templates' });
      return;
    }

    const templateMsg: TemplateMessage = {
      to: callFrom,
      templateName: env.EXOTEL_WELCOME_TEMPLATE,
      params: [clinic.clinicName],
      ...(clinic.channelAddress ? { channelAddress: clinic.channelAddress } : {}),
    };

    const result = await adapter.sendTemplate(templateMsg);
    claimed = false; // The send landed; the claim is now a real dedupe record.

    logger.info(
      { patientId: patient.id, clinicId: clinic.clinicId, templateMessageId: result.providerMessageId },
      'Sent WhatsApp template in response to missed call',
    );

    res.json({ ok: true, messageId: result.providerMessageId });
  } catch (error) {
    // Give the CallSid back so Exotel's retry is processed rather than being
    // mistaken for a duplicate of a call that never actually got a message.
    await releaseClaim();
    logger.error(
      { callSid, error: error instanceof Error ? error.message : String(error) },
      'Failed to process missed call',
    );
    res.status(500).json({ error: 'Failed to process call' });
  }
}

// GET is what Exotel's Passthru actually sends; POST is kept for everything else.
// Order matters: authenticate, then count, then act.
callWebhookRouter.get('/call-webhook', requireExotelToken, missedCallLimiter, handleMissedCall);
callWebhookRouter.post('/call-webhook', requireExotelToken, missedCallLimiter, handleMissedCall);
