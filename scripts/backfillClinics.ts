import crypto from 'node:crypto';
import { prisma } from '../src/db/prisma';

/**
 * Give every existing doctor a Clinic, grouped by the clinic name they already
 * carry.
 *
 * Idempotent: re-running adopts whatever is already there rather than making a
 * second clinic. Safe to run before the code that reads clinics is deployed,
 * because the WhatsApp number is *copied* — doctors.whatsapp_phone_number_id is
 * left intact, so routing keeps working from either side of the deploy.
 */
async function main() {
  const doctors = await prisma.doctor.findMany({ orderBy: { createdAt: 'asc' } });
  console.log(`${doctors.length} doctors`);

  for (const doctor of doctors) {
    if (doctor.clinicId) {
      console.log(`  ${doctor.name}: already in a clinic, skipping`);
      continue;
    }

    // Match on the number first: it is unique and authoritative. Falling back to
    // the name groups doctors who share a practice but have no number of their own.
    const existing = doctor.whatsappPhoneNumberId
      ? await prisma.clinic.findUnique({
          where: { whatsappPhoneNumberId: doctor.whatsappPhoneNumberId },
        })
      : await prisma.clinic.findFirst({ where: { name: doctor.clinicName } });

    const clinic =
      existing ??
      (await prisma.clinic.create({
        data: {
          name: doctor.clinicName,
          // Copied, not moved. See the note above.
          whatsappPhoneNumberId: doctor.whatsappPhoneNumberId,
          whatsappNumber: doctor.whatsappNumber,
          missedCallNumber: doctor.missedCallNumber,
          apiKey: `ck_${crypto.randomBytes(16).toString('hex')}`,
          timezone: doctor.timezone,
          defaultLanguage: doctor.defaultLanguage,
          status: doctor.status,
          channelStatus: doctor.channelStatus,
          channelReason: doctor.channelReason,
          channelErrorCode: doctor.channelErrorCode,
          channelSource: doctor.channelSource,
          channelCheckedAt: doctor.channelCheckedAt,
        },
      }));

    await prisma.doctor.update({
      where: { id: doctor.id },
      data: { clinicId: clinic.id },
    });

    console.log(
      `  ${doctor.name} -> ${clinic.name} (${existing ? 'joined existing' : 'created'})`,
    );
  }

  const clinics = await prisma.clinic.findMany({
    include: { doctors: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  console.log('\nResult:');
  for (const c of clinics) {
    console.log(
      `  ${c.name} [${c.whatsappPhoneNumberId ?? 'no number'}] key=${c.apiKey}`,
    );
    for (const d of c.doctors) console.log(`      - ${d.name}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
