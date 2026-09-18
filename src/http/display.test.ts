import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();
const findMany = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    doctor: { findUnique: (...a: unknown[]) => findUnique(...a) },
    appointment: { findMany: (...a: unknown[]) => findMany(...a) },
    $queryRaw: async () => [{ x: 1 }],
  },
}));

// Only the queue-state read is replaced; the rest of the module is real, since
// other routers mounted by createApp import from it too.
vi.mock('../domain/tokenQueue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domain/tokenQueue')>()),
  getOrCreateQueueState: async () => ({
    nowServingToken: 6,
    lastIssuedToken: 9,
    delayMins: 0,
    isClosed: false,
  }),
}));

import { createApp } from './app';

const DOCTOR = {
  id: 'doc-1',
  name: 'Ramesh Kumar',
  clinicName: 'Sunrise Clinic',
  specialty: 'General Physician',
  bookingMode: 'TOKEN',
  timezone: 'Asia/Kolkata',
  status: 'ACTIVE',
  whatsappNumber: '919731028452',
  apiKey: 'dk_the_console_key_that_must_not_work_here',
  displayKey: 'disp_0123456789abcdef',
  clinic: { name: 'Sunrise Clinic', whatsappNumber: '919731028452' },
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/**
 * This URL is pinned to a wall and read off the screen by whoever stands near
 * it. Everything here is about that: it must show a queue and nothing else, and
 * it must never accept the key that opens the console.
 */
describe('GET /display/:key', () => {
  it('serves the board to a caller with no session', async () => {
    findUnique.mockResolvedValueOnce(DOCTOR);
    findMany.mockResolvedValueOnce([{ tokenNumber: 7 }, { tokenNumber: 8 }]);

    const res = await fetch(`${base}/display/${DOCTOR.displayKey}`, { redirect: 'manual' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).toContain('Now serving');
  });

  /** A stale token on a wall is worse than no wall. */
  it('forbids caching', async () => {
    findUnique.mockResolvedValueOnce(DOCTOR);
    findMany.mockResolvedValueOnce([]);

    const res = await fetch(`${base}/display/${DOCTOR.displayKey}`);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  /**
   * The one that matters most: the console key must be useless here. Otherwise
   * a glance at the address bar on the waiting-room TV is full access to every
   * patient record.
   */
  it('refuses the doctor console key', async () => {
    findUnique.mockClear();
    findUnique.mockResolvedValueOnce(null);

    const res = await fetch(`${base}/display/${DOCTOR.apiKey}`);

    expect(res.status).toBe(404);
    // Looked up by displayKey alone — apiKey is never a lookup path, so a valid
    // console key simply matches nothing.
    expect(findUnique.mock.calls.at(-1)?.[0]?.where).toEqual({ displayKey: DOCTOR.apiKey });
  });

  it('404s an unknown key', async () => {
    findUnique.mockResolvedValueOnce(null);
    expect((await fetch(`${base}/display/${'z'.repeat(24)}`)).status).toBe(404);
  });

  /** Short keys are rejected before the database is touched. */
  it('404s a short key without querying', async () => {
    findUnique.mockClear();
    const res = await fetch(`${base}/display/abc`);

    expect(res.status).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('404s a disabled doctor', async () => {
    findUnique.mockResolvedValueOnce({ ...DOCTOR, status: 'DISABLED' });
    expect((await fetch(`${base}/display/${DOCTOR.displayKey}`)).status).toBe(404);
  });

  it('returns JSON for the poll, carrying only the changing half', async () => {
    findUnique.mockResolvedValueOnce(DOCTOR);
    findMany.mockResolvedValueOnce([{ tokenNumber: 7 }]);

    const res = await fetch(`${base}/display/${DOCTOR.displayKey}?fragment=1`);
    const body = (await res.json()) as { main: string; clock: string };

    expect(body.main).toContain('Now serving');
    expect(body.clock).toMatch(/\d{2}:\d{2}/);
    // The shell is not re-sent on every poll.
    expect(body.main).not.toContain('<html');
  });

  /**
   * The query selects only tokenNumber. If someone widens it to include the
   * patient relation, names reach a public wall — so assert the shape, not just
   * the output.
   */
  it('reads only token numbers from the database', async () => {
    findUnique.mockResolvedValueOnce(DOCTOR);
    findMany.mockResolvedValueOnce([{ tokenNumber: 7 }]);

    await fetch(`${base}/display/${DOCTOR.displayKey}`);

    const args = findMany.mock.calls.at(-1)?.[0];
    expect(args?.select).toEqual({ tokenNumber: true });
    expect(args?.include).toBeUndefined();
  });

  it('shows only numbers after the one being served', async () => {
    findUnique.mockResolvedValueOnce(DOCTOR);
    findMany.mockResolvedValueOnce([
      { tokenNumber: 4 },
      { tokenNumber: 6 },
      { tokenNumber: 7 },
      { tokenNumber: 8 },
    ]);

    const html = await (await fetch(`${base}/display/${DOCTOR.displayKey}`)).text();
    const chips = html.slice(html.indexOf('class="next"'));

    expect(chips).toContain('>7<');
    expect(chips).toContain('>8<');
    expect(chips).not.toContain('>4<');
  });
});
