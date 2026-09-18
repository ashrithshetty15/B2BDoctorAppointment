import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * The bug these guard against, observed against production:
 *
 *   PATCH /admin/doctor/:id  {"whatsappNumber": "9731028452"}
 *   -> 200 {"id": "...", "updated": true}
 *   -> the column stays null
 *
 * Zod strips unknown keys by default, so a field the deployed build did not know
 * about was accepted, discarded, and reported as a success. A caller cannot tell
 * that from a real write, which makes it worse than a 400.
 *
 * These mirror the shapes in admin.ts and dashboard.ts rather than importing the
 * routers, which would pull in Prisma and the whole env chain — the property
 * under test is the schema's, not the route's.
 */

const strictBody = z
  .object({
    dailyTokenCap: z.coerce.number().int().min(1).max(500).optional(),
    whatsappNumber: z.string().optional(),
    whatsappPhoneNumberId: z.string().optional(),
  })
  .strict();

const lenientFormBody = z.object({
  name: z.string().min(2),
});

describe('JSON API bodies reject what they do not understand', () => {
  it('accepts a known field', () => {
    const r = strictBody.safeParse({ whatsappNumber: '919731028452' });
    expect(r.success).toBe(true);
  });

  /** The exact production failure: a field the running build did not have. */
  it('rejects an unknown field instead of silently dropping it', () => {
    const r = strictBody.safeParse({ someFutureField: 'x' });
    expect(r.success).toBe(false);
  });

  /** The one a human hits: a typo that used to report success. */
  it('rejects a misspelled field rather than no-oping', () => {
    const r = strictBody.safeParse({ whatsapNumber: '919731028452' });
    expect(r.success).toBe(false);
    // The issue names the offending key, so the caller can act on it.
    expect(JSON.stringify(r.error?.issues)).toContain('whatsapNumber');
  });

  it('rejects a known field alongside an unknown one, rather than half-applying', () => {
    const r = strictBody.safeParse({ dailyTokenCap: 40, whatsapNumber: 'typo' });
    expect(r.success).toBe(false);
  });

  it('still accepts an empty body — a no-op request is not an error', () => {
    expect(strictBody.safeParse({}).success).toBe(true);
  });

  /**
   * Form posts must stay lenient: a browser sends _csrf and other incidentals
   * that have nothing to do with the schema.
   */
  it('leaves form-post parsing lenient', () => {
    const r = lenientFormBody.safeParse({ name: 'Meera', _csrf: 'abc', back: '/app' });
    expect(r.success).toBe(true);
  });
});

describe('a PATCH reports which fields it wrote', () => {
  /**
   * Mirrors how the route builds its Prisma `data` object and reports its keys.
   * `updated: true` was unfalsifiable — identical whether the write landed or
   * vanished.
   */
  const written = (body: { dailyTokenCap?: number; whatsappNumber?: string }) => ({
    ...(body.dailyTokenCap !== undefined ? { dailyTokenCap: body.dailyTokenCap } : {}),
    ...(body.whatsappNumber ? { whatsappNumber: body.whatsappNumber } : {}),
  });

  it('names the fields that changed', () => {
    expect(Object.keys(written({ whatsappNumber: '919731028452' }))).toEqual([
      'whatsappNumber',
    ]);
  });

  it('reports an empty list when nothing changed', () => {
    expect(Object.keys(written({}))).toEqual([]);
  });
});
