import { expect } from 'vitest';
import { handleInboundMessage } from '../engine';
import { world } from './world';

/**
 * Driving a conversation and reading back what the patient saw.
 *
 * Journeys are written as transcripts because that is the artefact everyone
 * can check: a clinic owner can read one and say whether it is what their
 * patients should get, which is not true of an assertion on a step name.
 */

let turn = 0;

export function resetTranscript(): void {
  turn = 0;
}

export interface Frame {
  said: string;
  /** Each outbound message as "text" plus its button titles. */
  replies: string[];
  step: string;
}

/** One inbound message, and everything the clinic sent back. */
export async function say(text: string): Promise<Frame> {
  const before = world.sent.length;
  turn += 1;

  await handleInboundMessage({
    providerMessageId: `journey-${turn}`,
    from: '919000000001',
    channelAddress: 'pn-test',
    text,
    receivedAt: world.now,
    raw: {},
  } as never);

  const replies = world.sent.slice(before).map(render);
  const session = world.sessions.get('919000000001');

  return { said: text, replies, step: String(session?.['step'] ?? 'ENTRY') };
}

function render(message: {
  text: string;
  buttons?: { id: string; title: string }[];
  list?: { rows: { id: string; title: string }[] };
}): string {
  const options = [
    ...(message.buttons ?? []).map((b) => b.title),
    ...(message.list?.rows ?? []).map((r) => r.title),
  ];
  return options.length ? `${message.text}\n[${options.join('] [')}]` : message.text;
}

/** Everything the patient could tap on the last thing they were sent. */
export function optionsOf(index = world.sent.length - 1): { id: string; title: string }[] {
  const message = world.sent[index] as
    | { buttons?: { id: string; title: string }[]; list?: { rows: { id: string; title: string }[] } }
    | undefined;
  return [...(message?.buttons ?? []), ...(message?.list?.rows ?? [])];
}

/**
 * THE REGRESSION NET.
 *
 * Tapping an option must not hand back the very message that offered it.
 *
 * That is the exact shape of the bug a clinic reported as "why is this going in
 * a loop": tap *Book a token*, receive the main menu; tap again, receive it
 * again, forever. It passed every unit test, because the engine's half and the
 * flow's half were each correct alone.
 *
 * Stated this way it needs no per-journey knowledge and holds for every mode
 * and clinic shape: a menu is a question, and answering a question cannot
 * return the same question. A refusal ("you have no token to cancel") is a
 * different message, so it passes; only a genuine no-op fails.
 *
 * `replay` must put a fresh patient back at the screen under test, because
 * tapping is destructive — it books things.
 */
export async function tapEveryOption(replay: () => Promise<void>): Promise<void> {
  await replay();
  const offered = render(world.sent[world.sent.length - 1] as never);
  const options = optionsOf();

  expect(options.length, 'the screen under test offers nothing to tap').toBeGreaterThan(0);

  for (const option of options) {
    await replay();
    const frame = await say(option.id);

    expect(
      frame.replies[0],
      `tapping "${option.title}" returned the same screen — the conversation cannot move`,
    ).not.toBe(offered);
  }
}
