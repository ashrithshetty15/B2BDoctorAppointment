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

### Postman

`postman/` holds a collection and environment covering the same ground as the curl
sections below, plus the admin routes:

```
postman/clinic-bot.postman_collection.json
postman/clinic-bot.local.postman_environment.json
```

Import both, pick the environment, then run folder **1 · Patient books a token**
top to bottom followed by **2 · Doctor works the queue**. The first request in
folder 2 captures `appointmentId` into the environment, so the status calls need
no copy-paste.

Two prerequisites, or every request appears to succeed while doing nothing:

- **`MESSAGING_PROVIDER=console` and a blank `WHATSAPP_APP_SECRET`.** Under
  `whatsapp_cloud` the simplified webhook body parses to zero messages (a silent
  `200`), and an absent `X-Hub-Signature-256` is rejected with `401`.
- **Run the worker too.** `POST /webhook` returns an empty `200`; replies only
  ever surface in the worker's stdout as `[outbound]`.

Both processes memoise the messaging adapter on first use, so restart them after
changing `MESSAGING_PROVIDER`.

If your `REDIS_URL` points at a Redis that a deployed instance also uses, set
`REDIS_QUEUE_PREFIX` (e.g. `bull-local`) so the two workers do not consume each
other's jobs.

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
3. Set the **clinic's** `whatsappPhoneNumberId` to the Meta `phone_number_id`
   that patients message — that is the routing key for every inbound message.
   Editable at **/app/clinics**. The matching field on a doctor row is a legacy
   fallback and should not be relied on for a new clinic.

Note: WhatsApp only allows free-form messages inside a 24-hour customer service
window. Replies to a patient's own message are fine; unprompted pushes (queue
updates, reminders, delay broadcasts) to someone who has not messaged in 24h
need approved **message templates** at the Meta end.

---

## Missed call via Exotel

A patient rings the clinic's number, the call is hung up without connecting, and
they get a WhatsApp message seconds later. A missed call is the one action every
patient in India already knows how to perform, and it costs them nothing.

The shape, per clinic:

```
patient dials the clinic's advertised number
  -> call forwards to that clinic's own ExoPhone
  -> Exotel hangs up after 1-2 rings and calls our Passthru URL
  -> we match CallTo (the ExoPhone) to Clinic.missedCallNumber
  -> we send clinic_welcome from that clinic's WhatsApp sender
```

`CallTo` is the ExoPhone that was dialled, which is why **one shared webhook
serves every clinic**: give each clinic its own ExoPhone and the dialled number
identifies the practice unambiguously.

### Once, for the deployment

Set `EXOTEL_WEBHOOK_TOKEN` (see `.env.example`). The route answers `503` to
everything while it is unset — it fails closed rather than reverting to open.

### Per clinic

1. Buy an ExoPhone for the clinic. This is a per-number rental and is the
   running cost of the feature.
2. In App Bazaar, create a flow whose first applet is a **Passthru** pointing at
   `https://<host>/call-webhook?token=<EXOTEL_WEBHOOK_TOKEN>`, in **async** mode
   so the call is not held open waiting on us.
3. Set the flow to hang up after 1–2 rings, so the caller is never charged and
   no agent leg is dialled.
4. Assign the flow to that clinic's ExoPhone.
5. Ask the clinic to set conditional call forwarding (busy / unanswered) from
   its advertised number to the ExoPhone.
6. At **/app/clinics**, set that clinic's **missed-call number** to the ExoPhone,
   and make sure its WhatsApp phone number ID is set too — the reply is sent from
   the clinic's own sender, so a clinic with no sender cannot answer a missed call.

Numbers are stored digits-only; the webhook strips non-digits from `CallTo`
before matching, so a stored `+91 …` would never be found. The form normalises
this for you.

### Checking it

```bash
curl "https://<host>/call-webhook?token=$EXOTEL_WEBHOOK_TOKEN\
&CallSid=test-1&CallFrom=919876543210&CallTo=<exophone>"
```

`200` with a message id means it worked. `404` means no clinic holds that
`CallTo` — the log line records the exact digits the lookup used, so read it back
from there rather than guessing the format. `401` is a bad token, `503` means
none is configured.

Two behaviours worth knowing: the `CallSid` is **claimed before** the send and
released if the send fails, so duplicate deliveries cannot double-message a
patient while a genuine failure is still retryable; and one caller is limited to
5 replies an hour, keyed on `CallFrom` rather than the source IP — every request
arrives from Exotel, so an IP bucket would count all clinics together.

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

- **One WhatsApp identity for the whole deployment.** `WHATSAPP_ACCESS_TOKEN` is
  a single global credential, so every clinic's number must sit under the same
  WABA. Inbound routing is already per-clinic (`Clinic.whatsappPhoneNumberId`),
  but sending is not: a per-clinic token is what a Meta Tech Provider needs, and
  it does not exist yet. Note the related sharp edge — the adapter falls back to
  `WHATSAPP_PHONE_NUMBER_ID` when a send carries no `channelAddress`, which means
  a forgotten channel sends from **another clinic's number**.
- **`Patient.phone` is globally unique**, so one patient row is shared across
  every clinic they message: `name`, `language` and `lastVisitAt` are written by
  whichever clinic spoke to them last.
- **Integration tests.** Unit coverage is real (612 tests across 53 files) but
  nothing exercises Postgres or Redis. A `docker compose`-backed test would be
  the first thing to add — and it would also give somewhere safe to rehearse a
  migration, which matters because local `.env` and Railway share one database.
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
