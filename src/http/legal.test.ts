import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { privacyPage, termsPage } from './legal';

/**
 * These pages are the reason the Meta app cannot go Live, and an app stuck in
 * Development Mode is why every send from the clinic's real number is refused.
 * So the property that actually matters is that an anonymous stranger — Meta's
 * reviewer — gets the content. A redirect to /app/login reads as "no policy".
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

describe.each([
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service'],
])('%s', (path, heading) => {
  it('serves HTML to a caller with no session and no CSRF token', async () => {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain(heading);
  });

  it('does not set a cookie or ask for one', async () => {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

/**
 * Collapse the HTML's own line wrapping before matching. Without this every
 * assertion silently depends on where the source happens to break a sentence.
 */
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('privacy policy content', () => {
  const body = flat(privacyPage());

  /** Meta rejects pages that say nothing; so would any regulator. */
  it('names the processors that actually see the data', () => {
    for (const party of ['Meta', 'WhatsApp', 'Railway']) {
      expect(body).toContain(party);
    }
  });

  it('is explicit that uploaded documents are health information', () => {
    expect(body).toMatch(/prescriptions/i);
    expect(body).toMatch(/health information/i);
  });

  it('covers the categories the schema actually stores', () => {
    for (const topic of ['phone number', 'language', 'token', 'follow-up', '24 hours']) {
      expect(body.toLowerCase()).toContain(topic.toLowerCase());
    }
  });

  /**
   * The service has no deletion job and no at-rest encryption of its own. The
   * page must not imply otherwise — an overstated policy is worse than a blunt
   * one, and this is the sentence most likely to drift.
   */
  it('does not promise automatic deletion', () => {
    expect(body).toMatch(/does not delete .*automatically/i);
    expect(body).not.toMatch(/encrypted at rest/i);
  });

  it('states the data is not sold or used for advertising', () => {
    expect(body).toMatch(/not sold/i);
    expect(body).toMatch(/advertis/i);
  });

  it('carries a last-updated date', () => {
    expect(body).toMatch(/Last updated \d{1,2} \w+ \d{4}/);
  });
});

describe('terms content', () => {
  const body = flat(termsPage());

  /** A clinic booking bot that does not say this is a real hazard. */
  it('tells the reader plainly that it is not for emergencies', () => {
    expect(body).toMatch(/not .*emergenc/i);
    expect(body).toMatch(/emergency number|nearest hospital/i);
  });

  it('disclaims medical advice', () => {
    expect(body).toMatch(/does not give medical advice/i);
  });
});
