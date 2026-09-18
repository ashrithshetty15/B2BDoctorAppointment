import crypto from 'node:crypto';
import { prisma } from '../src/db/prisma';

/**
 * Test data: two more doctors at Lakeview, so the clinic has three.
 *
 * Their working hours differ on purpose. Arjun runs a morning and an evening
 * session, which is exactly the shape that made the old flat time list unusable
 * — it is the case the morning/afternoon/evening picker exists for. Kavya is
 * afternoons only, so her day has a single period and the picker should skip
 * the question entirely.
 *
 * None of them gets a WhatsApp number: the number belongs to the clinic now.
 */

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;

const hours = (windows: Array<{ start: string; end: string }>, includeSat = true) => {
  const out: Record<string, Array<{ start: string; end: string }>> = {};
  for (const day of WEEKDAYS) out[day] = windows;
  if (includeSat) out['sat'] = windows.slice(0, 1);
  return out;
};

const DOCTORS = [
  {
    name: 'Arjun Rao',
    specialty: 'Paediatrician',
    qualification: 'MBBS, MD (Paed)',
    phone: '919845012345',
    consultDurationMins: 15,
    // Morning clinic, long break, evening clinic — two periods in one day.
    workingHours: hours([
      { start: '09:00', end: '12:30' },
      { start: '17:00', end: '20:00' },
    ]),
  },
  {
    name: 'Kavya Shetty',
    specialty: 'Dermatologist',
    qualification: 'MBBS, DDVL',
    phone: '919845067890',
    consultDurationMins: 20,
    // Afternoons only — a single period, so no picker question.
    workingHours: hours([{ start: '13:00', end: '16:30' }], false),
  },
];

async function main() {
  const clinic = await prisma.clinic.findFirst({ where: { name: 'Lakeview Clinic' } });
  if (!clinic) throw new Error('Lakeview Clinic not found — run backfillClinics first');

  for (const d of DOCTORS) {
    const existing = await prisma.doctor.findFirst({
      where: { name: d.name, clinicId: clinic.id },
    });
    if (existing) {
      console.log(`  ${d.name}: already present, skipping`);
      continue;
    }

    const created = await prisma.doctor.create({
      data: {
        name: d.name,
        clinicName: clinic.name,
        clinicId: clinic.id,
        phone: d.phone,
        specialty: d.specialty,
        qualification: d.qualification,
        bookingMode: 'SLOT',
        consultDurationMins: d.consultDurationMins,
        avgConsultTimeMins: d.consultDurationMins,
        workingHours: d.workingHours,
        timezone: clinic.timezone,
        defaultLanguage: clinic.defaultLanguage,
        apiKey: `dk_${crypto.randomBytes(16).toString('hex')}`,
      },
    });
    console.log(`  created ${created.name} (${created.specialty}) key=${created.apiKey}`);
  }

  const doctors = await prisma.doctor.findMany({
    where: { clinicId: clinic.id },
    orderBy: { name: 'asc' },
    select: { name: true, specialty: true, bookingMode: true, status: true, workingHours: true },
  });
  console.log(`\n${clinic.name} — ${doctors.length} doctors, one number (${clinic.whatsappPhoneNumberId}):`);
  for (const d of doctors) {
    const mon = (d.workingHours as Record<string, Array<{ start: string; end: string }>>)['mon'];
    const windows = (mon ?? []).map((w) => `${w.start}-${w.end}`).join(', ');
    console.log(`  ${d.name.padEnd(16)} ${(d.specialty ?? '').padEnd(16)} ${d.status}  Mon: ${windows}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
