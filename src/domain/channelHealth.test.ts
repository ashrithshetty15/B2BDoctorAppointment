import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn();
const updateMany = vi.fn();
const findUnique = vi.fn();

vi.mock('../db/prisma', () => ({
  prisma: {
    doctor: {
      update: (...a: unknown[]) => update(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
    },
  },
}));

vi.mock('../messaging', () => ({ getMessagingAdapter: () => ({}) }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { clearSendFailure, isStale, recordChannelHealth, recordSendFailure } from './channelHealth';

const NOW = new Date('2026-09-18T10:00:00Z');

beforeEach(() => {
  update.mockReset().mockResolvedValue({});
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  findUnique.mockReset();
});

describe('isStale', () => {
  it('treats a never-checked channel as stale', () => {
    expect(isStale(null, NOW)).toBe(true);
  });

  it('skips a reading taken five minutes ago and refreshes one from twenty', () => {
    expect(isStale(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe(false);
    expect(isStale(new Date(NOW.getTime() - 20 * 60_000), NOW)).toBe(true);
  });
});

/**
 * The behaviour these exist for: on 18 Sep the provider reported this clinic's
 * account AVAILABLE and its number merely LIMITED while refusing every single
 * send with #131005. A poll that can repaint a proven failure restores exactly
 * that blind spot, so the precedence is pinned here rather than left to reading.
 */
describe('poll versus send precedence', () => {
  it('lets a send write the status outright', async () => {
    await recordChannelHealth('doc-1', { status: 'BLOCKED', reason: 'Access denied', code: 131005 }, NOW, 'send');

    expect(updateMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: expect.objectContaining({
        channelStatus: 'BLOCKED',
        channelErrorCode: 131005,
        channelSource: 'send',
      }),
    });
  });

  it('guards a poll against overwriting a send-proven block', async () => {
    await recordChannelHealth('doc-1', { status: 'AVAILABLE' }, NOW, 'poll');

    const where = updateMany.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      id: 'doc-1',
      NOT: { channelSource: 'send', channelStatus: 'BLOCKED' },
    });
  });

  it('still moves the timestamp when the guard holds the poll back', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });

    await recordChannelHealth('doc-1', { status: 'AVAILABLE' }, NOW, 'poll');

    // Only the checked-at time — the status must survive untouched, or the
    // console would claim the channel recovered when nothing had changed.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { channelCheckedAt: NOW },
    });
  });

  it('writes the poll through when nothing has been proven by a send', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });

    await recordChannelHealth('doc-1', { status: 'LIMITED', reason: 'display name' }, NOW, 'poll');

    expect(update).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[0]?.[0]?.data).toMatchObject({
      channelStatus: 'LIMITED',
      channelSource: 'poll',
    });
  });

  it('defaults to a poll, so an unlabelled caller cannot fake proof', async () => {
    await recordChannelHealth('doc-1', { status: 'AVAILABLE' }, NOW);
    expect(updateMany).toHaveBeenCalled();
  });
});

describe('recordSendFailure', () => {
  it('attributes the refusal to the clinic that sends from that number', async () => {
    findUnique.mockResolvedValueOnce({ id: 'doc-lakeview' });

    await recordSendFailure('1404728522723325', '(#131005) Access denied', 131005, NOW);

    expect(findUnique).toHaveBeenCalledWith({
      where: { whatsappPhoneNumberId: '1404728522723325' },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'doc-lakeview' },
      data: expect.objectContaining({ channelStatus: 'BLOCKED', channelErrorCode: 131005 }),
    });
  });

  /** The shared fallback sender belongs to no clinic; guessing would be worse. */
  it('records nothing when the number maps to no clinic', async () => {
    findUnique.mockResolvedValueOnce(null);

    await recordSendFailure('1240078345864841', 'Access denied', 131005, NOW);

    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('carries a reason even when the provider gave no code', async () => {
    findUnique.mockResolvedValueOnce({ id: 'doc-1' });

    await recordSendFailure('123', 'something went wrong', undefined, NOW);

    expect(update.mock.calls[0]?.[0]?.data).toMatchObject({
      channelReason: 'something went wrong',
      channelErrorCode: null,
    });
  });
});

describe('clearSendFailure', () => {
  it('clears only a block a send established, leaving polled states alone', async () => {
    await clearSendFailure('1404728522723325', NOW);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        whatsappPhoneNumberId: '1404728522723325',
        channelSource: 'send',
        channelStatus: 'BLOCKED',
      },
      data: expect.objectContaining({ channelStatus: 'AVAILABLE', channelReason: null }),
    });
  });
});
