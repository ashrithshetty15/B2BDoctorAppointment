import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Seeds one TOKEN-mode doctor for local development.
 *   npm run seed
 * Prints the doctor id + API key to paste into .env / dashboard calls.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const existing = await prisma.doctor.findFirst({ where: { phone: '919000000001' } });
  if (existing) {
    console.log('Doctor already seeded:');
    console.log(`  DEFAULT_DOCTOR_ID=${existing.id}`);
    console.log(`  api key: ${existing.apiKey}`);
    return;
  }

  const doctor = await prisma.doctor.create({
    data: {
      name: 'Ramesh Kumar',
      clinicName: 'Sunrise Clinic',
      phone: '919000000001',
      bookingMode: 'TOKEN',
      bookingModeLockedAt: new Date(),
      dailyTokenCap: 40,
      consultDurationMins: 8,
      avgConsultTimeMins: 8,
      defaultLanguage: 'EN',
      timezone: 'Asia/Kolkata',
      workingHours: {
        mon: [{ start: '09:30', end: '13:00' }, { start: '17:00', end: '20:00' }],
        tue: [{ start: '09:30', end: '13:00' }, { start: '17:00', end: '20:00' }],
        wed: [{ start: '09:30', end: '13:00' }, { start: '17:00', end: '20:00' }],
        thu: [{ start: '09:30', end: '13:00' }, { start: '17:00', end: '20:00' }],
        fri: [{ start: '09:30', end: '13:00' }, { start: '17:00', end: '20:00' }],
        sat: [{ start: '09:30', end: '13:00' }],
      },
      apiKey: `dk_${crypto.randomBytes(24).toString('hex')}`,
    },
  });

  console.log('Seeded TOKEN-mode doctor.');
  console.log(`  DEFAULT_DOCTOR_ID=${doctor.id}`);
  console.log(`  api key: ${doctor.apiKey}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
