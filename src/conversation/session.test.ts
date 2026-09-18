import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A schema invariant, tested here because it took production down and the
 * mistake behind it is an easy one to repeat.
 *
 * A conversation is keyed on (phone, clinic). `doctorId` is ordinary state: it
 * starts null, gets set when the patient picks, and changes when they switch.
 * A unique index over it made switching *back* to a doctor the patient had
 * spoken to before fail outright — the upsert on (phone, clinic_id) tried to
 * write a doctor_id that a leftover row already held, every turn threw, and the
 * patient got "something went wrong on our side".
 *
 * The index had been kept on the reasoning that Postgres treats NULLs as
 * distinct so old rows could not collide. True of the (phone, clinic_id) index,
 * where the old rows have clinic_id NULL. Not true of (phone, doctor_id), where
 * they carry a real id and collide head on.
 */
describe('ConversationSession schema', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );

  const model = schema.slice(
    schema.indexOf('model ConversationSession'),
    schema.indexOf('model MessagingWindow'),
  );

  it('is keyed on phone and clinic', () => {
    expect(model).toMatch(/@@unique\(\[phone,\s*clinicId\]/);
  });

  /** The one that matters: never make mutable session state part of a key. */
  it('never makes doctorId part of a unique key', () => {
    const uniques = model.match(/@@unique\(\[[^\]]+\]/g) ?? [];
    expect(uniques.length).toBeGreaterThan(0);
    for (const u of uniques) {
      expect(u, `doctorId must not appear in ${u}`).not.toContain('doctorId');
    }
  });

  /** Null until the patient picks one, which is why it cannot be a key. */
  it('keeps doctorId optional', () => {
    expect(model).toMatch(/doctorId\s+String\?/);
  });
});
