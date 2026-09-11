import type { Language, Patient } from '@prisma/client';
import { prisma } from '../db/prisma';

export async function findOrCreatePatient(
  phone: string,
  defaults: { language?: Language; name?: string } = {},
): Promise<Patient> {
  return prisma.patient.upsert({
    where: { phone },
    create: {
      phone,
      ...(defaults.name ? { name: defaults.name } : {}),
      ...(defaults.language ? { language: defaults.language } : {}),
    },
    update: {},
  });
}

export async function setPatientName(patientId: string, name: string): Promise<Patient> {
  return prisma.patient.update({ where: { id: patientId }, data: { name } });
}

export async function setPatientLanguage(patientId: string, language: Language): Promise<Patient> {
  return prisma.patient.update({ where: { id: patientId }, data: { language } });
}

export async function markVisited(patientId: string, at: Date): Promise<void> {
  await prisma.patient.update({ where: { id: patientId }, data: { lastVisitAt: at } });
}

/** Patients accept a name if it has at least two word characters. */
export function isPlausibleName(input: string): boolean {
  const cleaned = input.trim();
  return cleaned.length >= 2 && /\p{L}{2,}/u.test(cleaned);
}
