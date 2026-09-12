import { Request, Response, Router } from 'express';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { getMessagingAdapter } from '../messaging';
import type { TemplateMessage } from '../messaging/types';

/**
 * Exotel missed-call webhook. When a patient calls the clinic's Exotel number,
 * Exotel fires an App Callback (HTTP POST) with the caller's details.
 * We use this to send an auto-reply WhatsApp template message.
 */

export const callWebhookRouter = Router();

/**
 * Exotel sends:
 * - CallSid: unique call identifier
 * - CallFrom: caller's phone (E.164 format, e.g. +919876543210)
 * - CallTo: the Exotel number dialled (e.g. +918130819820)
 * - Direction: always 'inbound' for missed-call webhook
 * - Status: 'completed', 'missed', 'failed', etc.
 *
 * We treat any incoming call as a missed-call trigger (Exotel auto-hangs up after 1-2 rings).
 */
interface ExotelCallEvent {
  CallSid?: string;
  CallFrom?: string;
  CallTo?: string;
  Direction?: string;
  Status?: string;
}

callWebhookRouter.post('/call-webhook', async (req: Request, res: Response) => {
  const event = req.body as ExotelCallEvent;
  const callSid = event.CallSid?.trim();
  const callFrom = event.CallFrom?.replace(/\D/g, ''); // Normalize to digits only
  const callTo = event.CallTo?.replace(/\D/g, '');

  // Minimal validation
  if (!callSid || !callFrom) {
    logger.warn({ event }, 'Incomplete Exotel call event');
    res.status(400).json({ error: 'Missing CallSid or CallFrom' });
    return;
  }

  // Dedupe: check if we already processed this call
  const existing = await prisma.processedMessage
    .findUnique({ where: { providerMessageId: callSid } })
    .catch(() => null);

  if (existing) {
    // Already processed — return 200 to ack but don't send again
    logger.debug({ callSid }, 'Duplicate call event, ignoring');
    res.json({ ok: true });
    return;
  }

  try {
    // Find or create the patient by their phone
    let patient = await prisma.patient.findUnique({ where: { phone: callFrom } });
    if (!patient) {
      patient = await prisma.patient.create({
        data: {
          phone: callFrom,
          language: 'EN', // Default to English; patient can switch via bot
        },
      });
      logger.debug({ patientId: patient.id, phone: callFrom }, 'Created patient from missed call');
    }

    // Resolve which doctor owns this Exotel number
    const doctor = await prisma.doctor.findUnique({
      where: { missedCallNumber: callTo },
    });

    if (!doctor) {
      logger.warn({ callTo }, 'No doctor found for missed-call number');
      res.status(404).json({ error: 'Doctor not found for this number' });
      return;
    }

    // Send the welcome template via WhatsApp
    const adapter = getMessagingAdapter();
    if (!adapter.sendTemplate) {
      logger.error({ adapter: adapter.name }, 'Adapter does not support templates');
      res.status(500).json({ error: 'Messaging adapter does not support templates' });
      return;
    }

    const templateMsg: TemplateMessage = {
      to: callFrom,
      templateName: 'clinic_welcome',
      params: [doctor.clinicName],
      channelAddress: doctor.whatsappPhoneNumberId || undefined,
    };

    const result = await adapter.sendTemplate(templateMsg);

    // Mark this call as processed (dedupe)
    await prisma.processedMessage.create({
      data: {
        providerMessageId: callSid,
      },
    });

    logger.info(
      { patientId: patient.id, doctorId: doctor.id, templateMessageId: result.providerMessageId },
      'Sent WhatsApp template in response to missed call'
    );

    res.json({ ok: true, messageId: result.providerMessageId });
  } catch (error) {
    logger.error(
      { callSid, callFrom, error: error instanceof Error ? error.message : String(error) },
      'Failed to process missed call'
    );
    res.status(500).json({ error: 'Failed to process call' });
  }
});
