import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deleteMany = vi.fn();
const createMany = vi.fn();
const update = vi.fn();
const transaction = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    externalBusy: {
      deleteMany: (...a: unknown[]) => deleteMany(...a),
      createMany: (...a: unknown[]) => createMany(...a),
    },
    doctor: { update: (...a: unknown[]) => update(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { syncBusyFeed } from './externalBusy';

/**
 * What happens when the calendar provider misbehaves.
 *
 * The failure that matters is not "the sync did not run" — it is a sync that
 * runs, gets nonsense, and empties a doctor's day. Availability is derived from
 * these rows, so wiping them silently makes a fully-booked afternoon look free
 * and lets patients book over real commitments.
 */

const doctor = { id: 'doc-1', busyFeedUrl: 'https://cal.example/feed.ics', timezone: 'Asia/Kolkata' };

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:a@x',
  `DTSTART:${new Date(Date.now() + 86_400_000).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
  `DTEND:${new Date(Date.now() + 90_000_000).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const respondWith = (body: string, ok = true, status = 200) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, text: async () => body })));

beforeEach(() => {
  deleteMany.mockReset();
  createMany.mockReset();
  update.mockReset().mockResolvedValue({});
  // $transaction takes the array of prepared operations; running it is enough.
  transaction.mockReset().mockImplementation(async (ops: unknown[]) => ops);
});

afterEach(() => vi.unstubAllGlobals());

describe('syncing a calendar feed', () => {
  it('imports the events and records the time', async () => {
    respondWith(ICS);

    const result = await syncBusyFeed(doctor);

    expect(result.ok).toBe(true);
    expect(result.imported).toBe(1);
    expect(transaction).toHaveBeenCalled();
  });

  /** The feed is the truth, so an event deleted there must stop blocking here. */
  it('replaces rather than accumulating', async () => {
    respondWith(ICS);

    await syncBusyFeed(doctor);

    expect(deleteMany).toHaveBeenCalled();
    const where = deleteMany.mock.calls[0]![0].where;
    expect(where.doctorId).toBe('doc-1');
    // Scoped forward, so a replace never rewrites history.
    expect(where.endsAt).toBeDefined();
  });

  /**
   * THE ONE THAT MATTERS. A provider being down, or a URL that has rotted into
   * a login page, must leave the existing blocks exactly where they are.
   */
  it.each([
    ['the request fails', () => vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND'); }))],
    ['it answers 500', () => respondWith('', false, 500)],
    ['it returns a login page', () => respondWith('<!doctype html><title>Sign in</title>')],
    ['it returns nonsense', () => respondWith('not a calendar at all')],
  ])('does not touch existing blocks when %s', async (_name, arrange) => {
    arrange();

    const result = await syncBusyFeed(doctor);

    expect(result.ok).toBe(false);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('records why it failed, for the console to show', async () => {
    respondWith('<!doctype html><title>Sign in</title>');

    await syncBusyFeed(doctor);

    const data = update.mock.calls.at(-1)![0].data;
    expect(data.busyFeedError).toMatch(/did not return a calendar/i);
  });

  /** The URL is the credential; it must not end up in a log line. */
  it('never puts the feed URL in the error it records', async () => {
    respondWith('nonsense');

    await syncBusyFeed(doctor);

    const data = update.mock.calls.at(-1)![0].data;
    expect(String(data.busyFeedError)).not.toContain('cal.example');
  });

  it('does nothing at all when no calendar is connected', async () => {
    respondWith(ICS);

    const result = await syncBusyFeed({ ...doctor, busyFeedUrl: null });

    expect(result).toEqual({ ok: true, imported: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
