import { Request, Response, Router } from 'express';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { getMessagingAdapter } from '../messaging';
import type { TemplateMessage } from '../messaging/types';

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
 * Who owns this number.
 *
 * Clinic first, because a missed call knows which *number* was dialled and not
 * which doctor — and one number per doctor is the trap that made a five-doctor
 * practice eat a quarter of a WABA. Resolving the clinic lets the bot ask which
 * doctor, exactly as it does for a patient who messages in. The doctor lookup
 * stays as a fallback for numbers configured before this existed.
 */
async function clinicForMissedCall(callTo: string) {
  const clinic = await prisma.clinic.findUnique({ where: { missedCallNumber: callTo } });
  if (clinic) {
    return {
      clinicId: clinic.id,
      clinicName: clinic.name,
      channelAddress: clinic.whatsappPhoneNumberId ?? undefined,
    };
  }

  const doctor = await prisma.doctor.findUnique({ where: { missedCallNumber: callTo } });
  if (doctor) {
    return {
      clinicId: doctor.clinicId ?? undefined,
      clinicName: doctor.clinicName,
      channelAddress: doctor.whatsappPhoneNumberId ?? undefined,
    };
  }

  return null;
}

async function handleMissedCall(req: Request, res: Response): Promise<void> {
  /**
   * The only thing standing between this URL and anyone on the internet.
   *
   * There was no authentication of any kind. Anyone who learned a clinic's
   * missed-call number could call this with any CallFrom they liked and have us
   * send a template to a stranger — from the clinic's own number, at the
   * clinic's cost, against the clinic's sender reputation. Exotel passes
   * arbitrary query parameters through untouched, so a shared secret in the URL
   * is both the smallest fix and the one Exotel can actually carry.
   *
   * Fails closed: with no token configured the endpoint refuses everything
   * rather than quietly reverting to open.
   */
  if (!env.EXOTEL_WEBHOOK_TOKEN) {
    logger.error('Missed-call webhook hit but EXOTEL_WEBHOOK_TOKEN is not set; refusing');
    res.status(503).json({ error: 'Not configured' });
    return;
  }
  if (field(req, 'token') !== env.EXOTEL_WEBHOOK_TOKEN) {
    logger.warn('Rejected missed-call webhook: bad or missing token');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

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

  const seen = await prisma.processedMessage
    .findUnique({ where: { providerMessageId: callSid } })
    .catch(() => null);

  if (seen) {
    logger.debug({ callSid }, 'Duplicate call event, ignoring');
    res.json({ ok: true });
    return;
  }

  try {
    const clinic = await clinicForMissedCall(callTo);
    if (!clinic) {
      // callTo is logged deliberately: it is the exact value the lookup used,
      // so configuring a new number is a matter of reading it back from here
      // rather than guessing which format Exotel sends.
      logger.warn({ callTo }, 'No clinic found for missed-call number');
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

    // Written only after the send succeeds, so a transient failure is retried
    // by Exotel rather than being swallowed as "already handled".
    await prisma.processedMessage.create({ data: { providerMessageId: callSid } });

    logger.info(
      { patientId: patient.id, clinicId: clinic.clinicId, templateMessageId: result.providerMessageId },
      'Sent WhatsApp template in response to missed call',
    );

    res.json({ ok: true, messageId: result.providerMessageId });
  } catch (error) {
    logger.error(
      { callSid, error: error instanceof Error ? error.message : String(error) },
      'Failed to process missed call',
    );
    res.status(500).json({ error: 'Failed to process call' });
  }
}

// GET is what Exotel's Passthru actually sends; POST is kept for everything else.
callWebhookRouter.get('/call-webhook', handleMissedCall);
callWebhookRouter.post('/call-webhook', handleMissedCall);
