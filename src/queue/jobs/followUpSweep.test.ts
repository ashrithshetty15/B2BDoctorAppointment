import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env } = vi.hoisted(() => ({
  env: { WHATSAPP_FOLLOWUP_TEMPLATE: 'followup_reminder' } as Record<string, unknown>,
}));

const findMany = vi.fn();
const update = vi.fn();
const sendTemplate = vi.fn();

vi.mock('../../config/env', () => ({ env }));
vi.mock('../../db/prisma', () => ({
  prisma: {
    appointment: {
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
vi.mock('../../messaging', () => ({
  getMessagingAdapter: () => ({ sendTemplate: (...a: unknown[]) => sendTemplate(...a) }),
}));
vi.mock('../../domain/doctors', () => ({ outboundChannelFor: () => 'pn-clinic' }));
vi.mock('../../domain/channelHealth', () => ({ sweepChannelHealth: async () => 0 }));
vi.mock('../queues', () => ({
  enqueueOutbound: vi.fn(),
  scheduleReminder: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { sweepDueFollowUps } from './reminders';

/**
 * Who the follow-up sweep is willing to message.
 *
 * This is the last gate before a template message reaches a real patient's
 * phone, weeks after they last spoke to the clinic, and it is the one piece of
 * the feature with no way to rehearse — the console adapter implements no
 * sendTemplate at all, so there is no dry run. The query is therefore asserted
 * rather than read.
 */

const row = {
  id: 'appt-1',
  patient: { phone: '919000000001', name: 'Asha', language: 'EN' },
  doctor: { id: 'doc-1', name: 'Arjun Rao', clinic: { name: 'Lakeview' } },
};

const whereOf = () => (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;

beforeEach(() => {
  env['WHATSAPP_FOLLOWUP_TEMPLATE'] = 'followup_reminder';
  findMany.mockReset().mockResolvedValue([]);
  update.mockReset().mockResolvedValue({});
  sendTemplate.mockReset().mockResolvedValue({ providerMessageId: 'wamid.1' });
});

describe('who the follow-up sweep will message', () => {
  /**
   * The visit has to have happened. Without this a patient who cancelled, or
   * never turned up, was messaged by name about following up a consultation
   * they never had.
   */
  it('skips visits that were cancelled or missed', async () => {
    await sweepDueFollowUps();

    expect(whereOf()['status']).toEqual({ notIn: ['CANCELLED', 'NO_SHOW'] });
  });

  /**
   * There was no floor, so a follow-up set months ago and never sent — because
   * no template was configured, which is exactly how this feature sat — counted
   * as due today, and would all have gone out at once.
   */
  it('ignores a follow-up that is more than 30 days overdue', async () => {
    await sweepDueFollowUps();

    const followUpOn = whereOf()['followUpOn'] as { lte: Date; gte: Date };
    const windowDays = (followUpOn.lte.getTime() - followUpOn.gte.getTime()) / 86_400_000;
    expect(Math.round(windowDays)).toBe(30);
  });

  it('still sends one that came due today', async () => {
    await sweepDueFollowUps();

    const followUpOn = whereOf()['followUpOn'] as { lte: Date };
    expect(followUpOn.lte.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('never re-sends one already sent', async () => {
    await sweepDueFollowUps();

    expect(whereOf()['followUpSentAt']).toBeNull();
  });

  /** 200 a sweep with no ordering lets one clinic's backlog starve the rest. */
  it('takes the oldest first, deterministically', async () => {
    await sweepDueFollowUps();

    const args = findMany.mock.calls[0]![0] as Record<string, unknown>;
    expect(args['orderBy']).toEqual({ followUpOn: 'asc' });
    expect(args['take']).toBe(200);
  });
});

describe('what the sweep sends', () => {
  it('sends the template and stamps the row', async () => {
    findMany.mockResolvedValue([row]);

    expect(await sweepDueFollowUps()).toBe(1);
    expect(sendTemplate.mock.calls[0]![0]).toMatchObject({
      to: '919000000001',
      templateName: 'followup_reminder',
      languageCode: 'en_US',
      params: ['Asha', 'Arjun Rao'],
      buttonPayload: 'FU:appt-1',
    });
    expect(update.mock.calls[0]![0]).toMatchObject({ where: { id: 'appt-1' } });
  });

  /** Approved per language: the wrong code is a refused send. */
  it('asks for the patient s own language, not the clinic s', async () => {
    findMany.mockResolvedValue([{ ...row, patient: { ...row.patient, language: 'KN' } }]);

    await sweepDueFollowUps();

    expect(sendTemplate.mock.calls[0]![0]).toMatchObject({ languageCode: 'kn' });
  });

  /**
   * Left unstamped on purpose, so the next sweep retries and the console keeps
   * showing it as pending rather than claiming the patient was told.
   */
  it('does not mark a failed send as sent', async () => {
    findMany.mockResolvedValue([row]);
    sendTemplate.mockRejectedValue(new Error('132000 parameter mismatch'));

    expect(await sweepDueFollowUps()).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('carries on after one patient fails', async () => {
    findMany.mockResolvedValue([row, { ...row, id: 'appt-2' }]);
    sendTemplate.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});

    expect(await sweepDueFollowUps()).toBe(1);
  });

  /**
   * With no approved template the send is not attempted at all. Meta refuses it
   * with an error the adapter cannot tell from a transient failure, which would
   * retry, drop, and mark nothing — leaving the clinic believing patients had
   * been reminded when none had.
   */
  it('does nothing at all until a template is configured', async () => {
    env['WHATSAPP_FOLLOWUP_TEMPLATE'] = undefined;

    expect(await sweepDueFollowUps()).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });
});
