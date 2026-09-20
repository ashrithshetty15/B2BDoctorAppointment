# Journeys — one per clinic shape

Three configurations exist in production. They take **different paths through
the same engine**, and a change that is obviously safe in one can break another
without a single unit test noticing.

| Shape | File | Looks like |
|---|---|---|
| One doctor, walk-in queue | [`soloToken.journey.test.ts`](soloToken.journey.test.ts) | Sunrise Clinic |
| One doctor, fixed times | [`soloSlot.journey.test.ts`](soloSlot.journey.test.ts) | a single-GP practice |
| Several doctors, one number | [`multiDoctor.journey.test.ts`](multiDoctor.journey.test.ts) | Lakeview Clinic |

```
npm run test:journeys          # all three
npm run test:journeys -- solo  # just the single-doctor pair
```

## Why these exist

Two bugs reached real clinics that every unit test passed through:

1. **A menu that repeated forever.** Tap *Book a token*, get the main menu. Tap
   again, get it again. Every single-doctor clinic, for two deploys.
2. **A doctor choice that would not change.** Pick Arjun once and every later
   turn was Arjun's, with no way back.

Both lived in the *seam*. `engine.test.ts` mocks the flows; `flows/*.test.ts`
mock the engine. Each half was correct on its own terms, and nothing ran them
together. The first bug also needed the single-doctor shape to show up at all —
the three-doctor clinic took a different branch and looked healthy right
through it.

So: real engine, real flows, real copy, one file per shape.

## What is real

Real: the engine, every flow, onboarding, the doctor picker, intent parsing,
session expiry, all patient-facing copy in both languages, and the slot
arithmetic.

Faked: persistence only — [`world.ts`](world.ts) keeps appointments, sessions
and patients in memory. Nothing in it decides what a patient sees.

**Not** a real database, deliberately. The local `.env` points at the
production database; a suite that connected to it would be one `beforeEach`
away from deleting a live clinic's appointments.

## The regression net

Each journey calls `tapEveryOption`, which asserts one thing:

> Tapping an option must not hand back the message that offered it.

That is the loop, stated so it needs no knowledge of any particular flow. It
holds for every mode and every shape — a menu is a question, and answering a
question cannot return the same question. A refusal ("you have no token to
cancel") is a different message, so it passes; only a genuine no-op fails.

Reintroducing the original bug fails 8 of the 11 solo-token tests, with:

```
tapping "Book a token" returned the same screen — the conversation cannot move
```

## Adding to them

Journeys are written as transcripts, because that is the artefact a clinic
owner can read and confirm. Prefer

```ts
expect(menu.replies[0]).toBe('Dr. Arjun Rao\n\nHow can we help you today?\n[Book appointment] …');
```

over an assertion on a step name. When copy changes, these fail loudly and the
diff *is* the review: you see exactly what every patient will now read.

If you add a fourth shape, add a fourth file rather than a branch inside an
existing one. The point is that each shape is walked end to end, on its own.
