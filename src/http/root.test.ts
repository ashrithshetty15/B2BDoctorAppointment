import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';

/**
 * The bare domain.
 *
 * Every route in this service lives under a prefix, so `/` matched nothing and
 * returned `{"error":"Not found"}`. That is correct JSON and a terrible front
 * door: a receptionist who types app.clinicforyou.org reads it as the service
 * being broken, not as having typed an incomplete address.
 */

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('the bare domain', () => {
  it('sends a visitor to the login page instead of a JSON error', async () => {
    const res = await fetch(`${base}/`, { redirect: 'manual' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app/login');
  });

  /**
   * /app/login and not /app: the login page serves doctors, front desks and
   * operators alike and needs no session, whereas /app requires an admin one
   * and would bounce a doctor straight back to where they started.
   */
  it('lands somewhere a doctor with no session can actually use', async () => {
    const res = await fetch(`${base}/app/login`, { redirect: 'manual' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('still 404s a genuinely unknown path', async () => {
    const res = await fetch(`${base}/no-such-page`, { redirect: 'manual' });

    expect(res.status).toBe(404);
  });

  /** The redirect must not depend on, or hand out, a session. */
  it('sets no cookie on the way through', async () => {
    const res = await fetch(`${base}/`, { redirect: 'manual' });

    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
