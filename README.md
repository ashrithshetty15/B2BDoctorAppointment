# Clinic Token & Appointment Bot — MVP backend

WhatsApp booking bot for single-doctor clinics. Node 20 + TypeScript + Express +
PostgreSQL (Prisma) + Redis (BullMQ), deployed as one Docker container against a
managed Postgres.

---

## ⚠️ Missing spec sections

The build prompt referenced **Sections 2, 3, 4 and 5** but they did not come
through — the schema slot still held the literal `[paste Section 2 schema here]`
placeholder, and the TOKEN / SLOT / HYBRID flow specs were absent.

Rather than block, everything was built with the guesses **isolated to two
files**:

| Missing section | What was assumed | Where to correct it |
| --- | --- | --- |
| §2 data model | Schema inferred from the behavioural requirements; every field the prompt named explicitly (`booking_mode`, `daily_token_cap`, `avg_consult_time_mins`, `working_hours`, `consult_duration_mins`, `leave_dates`, `last_visit`) exists | [prisma/schema.prisma](prisma/schema.prisma) |
| §3 TOKEN flow | menu → confirm → issue token, plus status and cancel branches | [src/conversation/flows/token.ts](src/conversation/flows/token.ts) + [src/i18n/templates.ts](src/i18n/templates.ts) |
| §4 SLOT flow | **Not implemented** — left a stub on purpose (the prompt said TOKEN mode first). The slot *engine* and reminders are done. | [src/conversation/flows/slot.ts](src/conversation/flows/slot.ts) |
| §5 HYBRID | One extra question ("fixed time or token?"), then delegate to the chosen flow | [src/conversation/flows/hybrid.ts](src/conversation/flows/hybrid.ts) |

**Message wording is not business logic here.** All patient-facing copy lives in
`templates.ts`, so aligning to the exact Section 3 strings touches no flow code.

---

## Status

| Requirement | State |
| --- | --- |
| 1. Prisma data model | ✅ Doctor, Patient, Appointment, QueueState (+ ConversationSession, ProcessedMessage) |
| 2. `booking_mode` set at onboarding, admin route only, write-once | ✅ |
| 3. Webhook + per-patient state machine, TOKEN flow | ✅ end-to-end vertical slice |
| 3. SLOT / HYBRID conversation flows | ⚠️ HYBRID routes; SLOT flow is a stub pending §4 |
| 4. Token queue engine (cap, rolling average, async position pushes) | ✅ |
| 5. Slot engine (generation from working hours) + reminders | ✅ engine + reminder jobs; needs the §4 flow to be reachable by patients |
| 6. Dashboard API (4 routes, API key per doctor) | ✅ |
| 7. Templates keyed `{language}.{templateName}`, EN + Kannada | ✅ |
| 8. State machine decoupled from the WhatsApp API (adapter) | ✅ |

Out of scope as instructed: payments, patient web app, EMR beyond
name/phone/last_visit, multi-doctor clinics, auth beyond API keys.

**Verified locally:** `tsc` clean, `npm run build` clean, 38 unit tests pass
(state machine, templates, slot generation, rolling average). The HTTP →
Postgres → Redis path has **not** been exercised on this machine — no Docker,
Postgres or Redis available here. [Run it yourself](#run-it) — it takes two
commands.

---

## Architecture

```
Meta WhatsApp Cloud API
        │  POST /webhook
        ▼
┌───────────────────────┐
│ http/webhook.ts       │  verify signature · parse · 200 fast
└───────────┬───────────┘
            │  InboundMessage  (provider-neutral)
            ▼
┌───────────────────────┐
│ conversation/engine   │  dedupe · resolve doctor · load session
│                       │  onboarding → flow → save session
└───────────┬───────────┘
            │  Reply[] + Effect[]        ┌──────────────────────┐
            ├───────────────────────────►│ BullMQ: outbound     │──► adapter.sendText()
            │                            ├──────────────────────┤
            └───────────────────────────►│ BullMQ: token-events │──► recalc + push positions
                                         ├──────────────────────┤
                                         │ BullMQ: reminders    │──► day-before / hour-before
                                         └──────────────────────┘
```

Two boundaries do the heavy lifting:

**Provider swap (requirement 8).** The state machine imports only
`InboundMessage` / `OutboundMessage` from
[src/messaging/types.ts](src/messaging/types.ts). A provider is touched in
exactly one place — [src/queue/jobs/outbound.ts](src/queue/jobs/outbound.ts),
which calls `adapter.sendText()`. To move to Gupshup/Interakt: add an adapter in
`src/messaging/adapters/`, register it in
[src/messaging/index.ts](src/messaging/index.ts), change
`MESSAGING_PROVIDER`. No flow file changes. The token flow tests
([token.test.ts](src/conversation/flows/token.test.ts)) run with no provider and
no database at all, which is the proof.

**Nothing slow in the webhook.** Flows return declarative `Effect`s
(`RECALC_TOKEN_QUEUE`, …) rather than performing them. The engine turns those
into jobs, so a 40-patient position broadcast never sits inside a Meta webhook
request.

### Layout

```
prisma/schema.prisma          data model + initial migration
src/
  config/env.ts              zod-validated environment
  messaging/                 ◄── provider boundary
    types.ts                 MessagingAdapter, InboundMessage, OutboundMessage
    adapters/whatsappCloud.ts  Meta Cloud API: signature, parse, send
    adapters/console.ts        local dev: logs instead of sending
  conversation/              ◄── state machine (no provider imports)
    engine.ts                orchestration: session → onboarding → flow → effects
    session.ts               (phone, doctor_id) state store, Postgres-backed
    intent.ts                input normalisation (numbers + EN/Kanglish/Kannada keywords)
    steps.ts                 every step name
    flows/onboarding.ts      language + name capture, mode-independent
    flows/token.ts           TOKEN MODE
    flows/slot.ts            SLOT MODE (stub — see §4 note)
    flows/hybrid.ts          HYBRID MODE
  domain/                    business rules over Prisma
    tokenQueue.ts            atomic token assignment, cap, ETA, rolling average
    slots.ts                 slot generation from working_hours
    appointments.ts          status lifecycle transitions
  services/notifications.ts  position pushes, delay broadcast, status messages
  queue/                     BullMQ queues + workers
  http/                      webhook, dashboard, admin routes
  i18n/templates.ts          ALL patient-facing copy (EN + KN)
```

---

## Run it

```bash
cp .env.example .env          # defaults work for local dev
docker compose up -d postgres redis
npx prisma migrate deploy     # applies prisma/migrations/0_init
npm run seed                  # prints DEFAULT_DOCTOR_ID + the doctor's API key
# paste DEFAULT_DOCTOR_ID into .env, then:
npm run dev                   # API  :3000
npm run dev:worker            # BullMQ worker (separate terminal)
```

`MESSAGING_PROVIDER=console` (the default) logs outbound messages to stdout and
accepts a simplified inbound payload, so the whole TOKEN flow can be driven with
curl and no Meta account.

### Drive the TOKEN flow end to end

Each call returns `200` and the bot's reply appears in the **worker** log.

```bash
# 1. first contact -> language prompt
curl -X POST localhost:3000/webhook -H 'content-type: application/json' \
  -d '{"from":"919876543210","text":"hi"}'

# 2. choose English -> asks for name
curl -X POST localhost:3000/webhook -H 'content-type: application/json' \
  -d '{"from":"919876543210","text":"1"}'

# 3. give name -> TOKEN menu
curl -X POST localhost:3000/webhook -H 'content-type: application/json' \
  -d '{"from":"919876543210","text":"Asha"}'

# 4. "1" = book -> confirmation prompt
curl -X POST localhost:3000/webhook -H 'content-type: application/json' \
  -d '{"from":"919876543210","text":"1"}'

# 5. "1" = yes -> token issued, with position + ETA
curl -X POST localhost:3000/webhook -H 'content-type: application/json' \
  -d '{"from":"919876543210","text":"1"}'

# 6. "2" = status -> now serving / ahead / ETA
curl -X POST localhost:3000/webhook -H 'content-type: application/json' \
  -d '{"from":"919876543210","text":"2"}'
```

Kannada: send `2` at step 2 and every later message arrives in Kannada script.
Replies are accepted in Kannada script or Latin/Kanglish. A patient can type
`lang` at any point to switch.

### Dashboard

```bash
KEY=dk_...   # from npm run seed
DOC=...      # DEFAULT_DOCTOR_ID

curl -H "x-api-key: $KEY" localhost:3000/doctor/$DOC/today

curl -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' \
  localhost:3000/appointment/<APPT_ID>/status -d '{"status":"in-progress"}'
# ...then {"status":"done"} -> folds the real consult length into
# avg_consult_time_mins and pushes new ETAs to everyone still waiting

curl -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' \
  localhost:3000/doctor/$DOC/delay-broadcast -d '{"delayMins":30}'

curl -X POST -H "x-api-key: $KEY" -H 'content-type: application/json' \
  localhost:3000/doctor/$DOC/leave -d '{"date":"2026-09-20"}'
```

### Onboarding a doctor

```bash
curl -X POST -H "x-api-key: $ADMIN_API_KEY" -H 'content-type: application/json' \
  localhost:3000/admin/doctor -d '{
    "name":"Ramesh Kumar", "clinicName":"Sunrise Clinic", "phone":"919000000001",
    "bookingMode":"TOKEN", "dailyTokenCap":40, "consultDurationMins":8,
    "whatsappPhoneNumberId":"<meta phone_number_id>",
    "workingHours":{"mon":[{"start":"09:30","end":"13:00"}]}
  }'
```

The response includes the doctor's dashboard API key — **shown once**.
`booking_mode` is locked at creation; `POST /admin/doctor/:id/booking-mode`
returns `409` unless sent `{"force": true}`, which also clears in-flight
conversations so no patient is stranded in a step the new flow does not own.

---

## Going live on WhatsApp

1. `MESSAGING_PROVIDER=whatsapp_cloud`, set `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and
   **`WHATSAPP_APP_SECRET`** (without it, signature verification is skipped and
   the endpoint logs a warning — never run production that way).
2. Point Meta's webhook at `https://<host>/webhook` with the same verify token.
   `GET /webhook` answers the handshake.
3. Set each doctor's `whatsappPhoneNumberId` to the Meta `phone_number_id` that
   patients message — that is how an inbound message is routed to a doctor.

Note: WhatsApp only allows free-form messages inside a 24-hour customer service
window. Replies to a patient's own message are fine; unprompted pushes (queue
updates, reminders, delay broadcasts) to someone who has not messaged in 24h
need approved **message templates** at the Meta end. The code is ready for it —
`OutboundJob` already carries `templateName` — but registering those templates
and sending them as `type: "template"` is not built yet.

---

## Design decisions worth knowing

- **Token numbers are never recycled.** A cancellation leaves a gap; patients
  hold a number and reissuing it would be confusing. `daily_token_cap` therefore
  caps tokens *issued* for the day.
- **Assignment is one atomic statement.** `UPDATE ... SET last_issued_token =
  last_issued_token + 1 WHERE ... AND last_issued_token < cap RETURNING` —
  two patients booking in the same millisecond cannot collide or exceed the cap.
- **Patients are not spammed.** `Appointment.lastNotifiedPosition` suppresses
  no-op pushes: one message per patient per consult, not one per patient per
  event. Recalc jobs are also debounced ~10s.
- **Rolling average is an EWMA past 20 samples**, so it tracks today's pace
  instead of being anchored by history. A consult is clamped to 1–120 minutes so
  a forgotten "Done" over lunch cannot poison it.
- **Sessions live in Postgres, not Redis.** One less thing to lose, and the
  dashboard can see where a patient is stuck. Keyed `(phone, doctor_id)` with a
  120-minute idle expiry; an expired session restarts at the entry step.
- **Webhook idempotency.** `ProcessedMessage` records the provider's message id
  after a successful turn, so Meta's retries do not double-book. Bookings are
  independently idempotent per patient per day.
- **Reminders are belt-and-braces:** exact delayed jobs at booking time, plus a
  10-minute sweep over the Appointment table that catches anything missed while
  the worker was down. The `*ReminderSentAt` columns keep both paths idempotent.

---

## Known gaps

- **SLOT conversation flow** — stub pending §4 (engine, templates, reminders and
  step names are all in place).
- **WhatsApp message templates** for pushes outside the 24-hour window (above).
- **Interactive buttons.** The adapter already flattens button/list replies to
  text, but outbound messages are plain text with numbered menus. Sending real
  quick-reply buttons is an adapter-only change.
- **Integration tests.** Unit coverage is real (38 tests) but nothing exercises
  Postgres or Redis; no container runtime was available on the build machine.
  A `docker compose`-backed test would be the first thing to add.
- **Inbound is processed synchronously** inside the webhook request (a handful of
  queries). All sends are already queued, so this is fine at MVP volume; if turns
  get slow, add an inbound queue and return `200` immediately.
- `avg_consult_time_mins` is per doctor, not per time-of-day. Evening clinics
  usually run faster than mornings.

---

## Commands

| | |
| --- | --- |
| `npm run dev` / `npm run dev:worker` | API / worker with reload |
| `npm run build` | `prisma generate` + compile to `dist/` |
| `npm start` / `npm run start:worker` | production entrypoints |
| `npm run typecheck` | `tsc --noEmit` (includes tests) |
| `npm test` | vitest |
| `npm run prisma:migrate` | create a new migration (needs a live DB) |
| `npm run prisma:deploy` | apply migrations |
| `npm run seed` | seed one TOKEN-mode doctor |
