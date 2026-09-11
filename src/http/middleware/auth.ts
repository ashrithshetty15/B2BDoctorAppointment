import type { Doctor } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { getDoctorByApiKey } from '../../domain/doctors';

/**
 * MVP auth: one API key per doctor, sent as `x-api-key`. Nothing else.
 * The key both authenticates and scopes — a doctor's key only opens that
 * doctor's rows, so `/doctor/:id/...` must match the key's owner.
 */

declare module 'express-serve-static-core' {
  interface Request {
    doctor?: Doctor;
  }
}

function readKey(req: Request): string {
  const header = req.header('x-api-key');
  if (header) return header.trim();

  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

  return '';
}

export async function requireDoctorApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = readKey(req);
  if (!key) {
    res.status(401).json({ error: 'Missing x-api-key header' });
    return;
  }

  const doctor = await getDoctorByApiKey(key);
  if (!doctor) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // Routes shaped /doctor/:doctorId/... must address the key's own doctor.
  // The param is deliberately NOT called `id`: routes like
  // /appointment/:id/status carry an appointment id there, and comparing that
  // against a doctor id would reject every legitimate call.
  const routeDoctorId = req.params['doctorId'];
  if (routeDoctorId && routeDoctorId !== doctor.id) {
    res.status(403).json({ error: 'API key does not belong to this doctor' });
    return;
  }

  req.doctor = doctor;
  next();
}

export function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const key = readKey(req);
  if (!key || key !== env.ADMIN_API_KEY) {
    res.status(401).json({ error: 'Invalid admin key' });
    return;
  }
  next();
}
