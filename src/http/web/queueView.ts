import type { Doctor, Language } from '@prisma/client';
import { type ConsoleStrings, c, elapsed, formatMins } from '../../i18n/console';
import type { AppointmentStatus } from '@prisma/client';
import {
  primaryAction,
  secondaryActions,
  sectionFor,
  waitLevel,
  waitedMins,
} from '../../domain/queueLifecycle';
import { statusPill, type QueueRow, type QueueState } from './doctorViews';
import { type RawHtml, html, page, raw } from './layout';
import { doctorBottomNav, doctorHeader, type ConsoleDoctor } from './nav';
import { bookingLink, qrSvg } from './qr';

/** Waiting longer than this turns the row amber. */
const OVERDUE_MINS = 30;

const WA_ICON = raw(
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.7 15l-1.3 5 5.1-1.3A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20zm4.4-5.8c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.1-.2 0-.4.1-.5l.4-.5.2-.4v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3A3 3 0 0 0 8 10c0 1.3 1 2.6 1.1 2.8a10 10 0 0 0 3.9 3.4c1.3.5 1.9.6 2.5.5.4 0 1.3-.5 1.5-1.1.2-.5.2-1 .1-1.1z"/></svg>',
);

function personName(name: string | null, language: Language): string {
  if (name && name.trim()) return name;
  return language === 'KN' ? 'ಹೆಸರು ಇಲ್ಲ' : 'Unnamed';
}

function timeOnly(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** When a waiting patient's clock started: arrival if checked in, else booking. */
/**
 * Waiting is measured from arrival, never from booking.
 *
 * It used to fall back to the booking time, so a patient who booked at 07:13
 * for a 10:00 appointment was shown as having waited nearly three hours while
 * sitting at home.
 */
function waitingSince(row: QueueRow): Date | null {
  return row.arrivedAt;
}

// ---- hero ----

function hero(opts: {
  serving: QueueRow | undefined;
  s: ConsoleStrings;
  language: Language;
  now: Date;
}): RawHtml {
  const { serving, s, language, now } = opts;

  if (!serving) {
    return html`
      <section class="hero idle" aria-live="polite">
        <div class="eyebrow">${s.nowServing}</div>
        <div class="token">${s.noOneInRoom}</div>
      </section>
    `;
  }

  const since = serving.startedAt ?? serving.arrivedAt;
  return html`
    <section class="hero" aria-live="polite">
      <div class="eyebrow">${s.nowServing}</div>
      <div class="token"><span class="hash">#</span>${serving.tokenNumber}</div>
      <div class="who">${personName(serving.patient.name, language)}</div>
      ${since ? html`<div class="meta">${s.inRoomFor(elapsed(since, language, now))}</div>` : ''}
    </section>
  `;
}

// ---- primary action ----

/**
 * The single primary action, which changes with the state of the room rather
 * than ever being a dead disabled button.
 *
 * Only one patient may be in the room at a time — two concurrent IN_PROGRESS
 * rows would corrupt the consult timings that drive every ETA. So while someone
 * is in, the action is to finish with them; once the room is clear it becomes
 * calling the next patient. That sequencing enforces the rule through the
 * natural path rather than by blocking the doctor with an error.
 */
function primaryCta(opts: {
  serving: QueueRow | undefined;
  next: QueueRow | undefined;
  s: ConsoleStrings;
  language: Language;
  csrfToken: string;
}): RawHtml {
  const { serving, next, s, language, csrfToken } = opts;

  if (serving) {
    return html`
      <form method="post" action="/app/queue/${serving.appointmentId}/status">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="hidden" name="status" value="done" />
        <button class="cta" type="submit">
          <span>
            <span class="lead">${s.finishCurrent}</span>
            <span class="next"
              >${s.callNextWith(serving.tokenNumber ?? 0, personName(serving.patient.name, language))}</span
            >
          </span>
          <span class="chev" aria-hidden="true">✓</span>
        </button>
      </form>
    `;
  }

  if (!next) {
    return html`
      <button class="cta" type="button" disabled>
        <span>
          <span class="lead">${s.callNext}</span>
          <span class="next">${s.nobodyWaiting}</span>
        </span>
      </button>
    `;
  }

  return html`
    <form method="post" action="/app/queue/${next.appointmentId}/status">
      <input type="hidden" name="_csrf" value="${csrfToken}" />
      <input type="hidden" name="status" value="in-progress" />
      <button class="cta" type="submit">
        <span>
          <span class="lead">${s.callNext}</span>
          <span class="next">${s.callNextWith(next.tokenNumber ?? 0, personName(next.patient.name, language))}</span>
        </span>
        <span class="chev" aria-hidden="true">→</span>
      </button>
    </form>
  `;
}

// ---- stats ----

function stats(opts: {
  queue: QueueState;
  avgWaitMins: number | null;
  s: ConsoleStrings;
  language: Language;
}): RawHtml {
  const { queue, avgWaitMins, s, language } = opts;
  // Tone follows load rather than being decorative: amber only once the wait is
  // long enough that the doctor would want to act on it.
  const busyQueue = queue.waiting >= 6;
  const busyWait = avgWaitMins !== null && avgWaitMins >= OVERDUE_MINS;
  const unit = language === 'KN' ? 'ನಿ' : 'min';

  return html`
    <div class="stats">
      <div class="s ${busyQueue ? 'busy' : ''}">
        <div class="n">${queue.waiting}</div>
        <div class="l">${s.waiting}</div>
      </div>
      <div class="s">
        <div class="n">${queue.lastIssuedToken}</div>
        <div class="l">${s.issuedToday}</div>
      </div>
      <div class="s ${busyWait ? 'busy' : ''}">
        <div class="n">${avgWaitMins === null ? '—' : `${avgWaitMins} ${unit}`}</div>
        <div class="l">${s.avgWait}</div>
      </div>
    </div>
  `;
}

/**
 * The remark, shown inline and editable in place via <details> — no JavaScript,
 * and the doctor never loses the queue to reach it. Collapsed when empty so an
 * unused field costs no vertical space on a busy day.
 */
function noteBlock(opts: {
  row: QueueRow;
  s: ConsoleStrings;
  csrfToken: string;
  back: string;
}): RawHtml {
  const { row, s, csrfToken, back } = opts;
  return html`
    <details class="note" ${row.notes ? raw('open') : ''}>
      <summary>${row.notes ? s.editNote : s.addNote}</summary>
      ${row.notes ? html`<p class="notetext">${row.notes}</p>` : ''}
      <form method="post" action="/app/appointment/${row.appointmentId}/note">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="hidden" name="back" value="${back}" />
        <textarea name="notes" rows="2" maxlength="500" placeholder="${s.notesPlaceholder}">
${row.notes ?? ''}</textarea
        >
        <button class="ghost" type="submit">${s.saveNote}</button>
      </form>
    </details>
  `;
}

// ---- waiting rows ----

/**
 * Call in appears on every waiting row, not just the hero CTA, so the doctor can
 * take whoever is actually present rather than only the lowest token — patients
 * step outside. Styled secondary rather than accent so the hero remains the only
 * accent-coloured control.
 *
 * `roomBusy` hides it while someone is in the room: the server rejects a second
 * concurrent call anyway, and offering a button that will be refused is worse
 * than not offering it.
 */
function servingRow(opts: {
  row: QueueRow;
  s: ConsoleStrings;
  language: Language;
  csrfToken: string;
}): RawHtml {
  const { row, s, language, csrfToken } = opts;
  return html`
    <div class="qrow">
      <div class="tok">${row.tokenNumber}</div>
      <div class="body">
        <div class="nm">${personName(row.patient.name, language)}</div>
        <div class="sub"><span class="pill in_progress">${s.nowServing}</span></div>
        ${noteBlock({ row, s, csrfToken, back: '/app/queue' })}
      </div>
      <div class="acts">
        ${/* A link, not a sheet: this region is replaced every 30s. */ ''}
        <a href="/app/appointment/${row.appointmentId}/followup?back=/app/queue"
          ><button class="ghost" type="button">${s.followUp}</button></a
        >
        <form method="post" action="/app/queue/${row.appointmentId}/recall">
          <input type="hidden" name="_csrf" value="${csrfToken}" />
          <button class="ghost" type="submit">${s.recall}</button>
        </form>
        <form method="post" action="/app/queue/${row.appointmentId}/status">
          <input type="hidden" name="_csrf" value="${csrfToken}" />
          <input type="hidden" name="status" value="done" />
          <button class="secondary" type="submit">${s.done}</button>
        </form>
      </div>
    </div>
  `;
}


/** Status value the POST handler expects, e.g. IN_PROGRESS -> "in-progress". */
function statusParam(status: AppointmentStatus): string {
  return status.toLowerCase().replace(/_/g, '-');
}

function actionLabel(status: AppointmentStatus, s: ConsoleStrings): string {
  switch (status) {
    case 'ARRIVED':
      return s.arrived;
    case 'IN_PROGRESS':
      return s.callIn;
    case 'DONE':
      return s.done;
    case 'NO_SHOW':
      return s.noShow;
    default:
      return status;
  }
}

/**
 * One card, offering exactly one primary action for the state it is in.
 *
 * Previously every waiting row rendered Arrived, Call in and No show side by
 * side, so the desk had to read each card to find the one that applied. The
 * state machine already knows which move comes next; everything else valid goes
 * behind "More".
 */
function queueCard(opts: {
  row: QueueRow;
  s: ConsoleStrings;
  language: Language;
  timezone: string;
  csrfToken: string;
  now: Date;
}): RawHtml {
  const { row, s, language, timezone, csrfToken, now } = opts;
  const status = row.status as AppointmentStatus;
  const mins = waitedMins(row, now);
  const level = waitLevel(mins);
  const primary = primaryAction(status);

  const act = (to: AppointmentStatus, cls: string) => html`
    <form method="post" action="/app/queue/${row.appointmentId}/status">
      <input type="hidden" name="_csrf" value="${csrfToken}" />
      <input type="hidden" name="status" value="${statusParam(to)}" />
      <button class="${cls}" type="submit">${actionLabel(to, s)}</button>
    </form>
  `;

  const overflow = secondaryActions(status);

  return html`
    <div class="qrow ${level === 'urgent' ? 'overdue' : ''}">
      <div class="tok">${badgeFor(row, timezone)}</div>
      <div class="body">
        <div class="nm">${personName(row.patient.name, language)}</div>
        <div class="sub">
          ${statusPill(row.status)} ${timingLabel({ row, s, timezone, now, language })}
          <span class="mask">${maskPhone(row.patient.phone)}</span>
          <span class="wa">${row.source === 'WALK_IN' ? s.viaWalkIn : s.viaWhatsapp}</span>
        </div>
        ${noteBlock({ row, s, csrfToken, back: '/app/queue' })}
      </div>
      <div class="acts">
        ${primary ? act(primary as AppointmentStatus, 'secondary') : ''}
        ${overflow.length > 0
          ? html`<details class="overflow">
              <summary>${s.moreActions}</summary>
              <div class="menu-items">${overflow.map((to) => act(to, 'ghost'))}</div>
            </details>`
          : ''}
      </div>
    </div>
  `;
}

/** Token number where there is one, appointment time where there is not. */
function badgeFor(row: QueueRow, timezone: string): string {
  if (row.tokenNumber !== null) return `#${row.tokenNumber}`;
  return row.slotStart ? timeOnly(row.slotStart, timezone) : '—';
}

/** Last four digits only: the desk needs to confirm identity, not read it out. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? phone : `••••${phone.slice(-4)}`;
}

/**
 * What the time column says, which depends entirely on whether they are here.
 *
 * A booked patient gets their expected time or how late they are; only someone
 * who has actually arrived gets a waiting clock.
 */
function timingLabel(opts: {
  row: QueueRow;
  s: ConsoleStrings;
  timezone: string;
  now: Date;
  language: Language;
}): RawHtml {
  const { row, s, timezone, now, language } = opts;
  const mins = waitedMins(row, now);

  if (mins !== null) {
    const level = waitLevel(mins);
    // The measured wait, not time-since-arrival: once they are called in the
    // number must stop, or an in-room patient's wait climbs all afternoon.
    return html`<span class="waited ${level === 'urgent' ? 'over' : level === 'warn' ? 'warn' : ''}"
      >${s.waitedFor(formatMins(mins, language))}</span
    >`;
  }

  if (!row.slotStart) return html``;

  const late = row.slotStart.getTime() < now.getTime();
  return late
    ? html`<span class="waited warn">${s.lateBy(elapsed(row.slotStart, language, now))}</span>`
    : html`<span>${s.expectedAt(timeOnly(row.slotStart, timezone))}</span>`;
}

/** One titled group of cards, or a line saying it is empty. */
function section(opts: {
  title: string;
  rows: QueueRow[];
  empty: string | null;
  s: ConsoleStrings;
  language: Language;
  timezone: string;
  csrfToken: string;
  now: Date;
}): RawHtml {
  const { title, rows, empty } = opts;
  if (rows.length === 0 && empty === null) return html``;

  return html`
    <h2 class="secl">${title}${rows.length > 0 ? html` · ${String(rows.length)}` : ''}</h2>
    <div class="card flush">
      ${rows.length > 0
        ? rows.map((row) =>
            queueCard({
              row,
              s: opts.s,
              language: opts.language,
              timezone: opts.timezone,
              csrfToken: opts.csrfToken,
              now: opts.now,
            }),
          )
        : html`<div class="qrow"><div class="body muted">${empty ?? ''}</div></div>`}
    </div>
  `;
}

// ---- empty state ----

function emptyState(bookingNumber: string | null, s: ConsoleStrings): RawHtml {
  if (!bookingNumber) {
    return html`
      <div class="empty">
        <h3>${s.noBookingsTitle}</h3>
        <p>${s.noBookingsBody}</p>
        <p class="caveat">
          Add this clinic's WhatsApp number in settings to show a booking QR code here.
        </p>
      </div>
    `;
  }

  const link = bookingLink(bookingNumber);
  return html`
    <div class="empty">
      <h3>${s.noBookingsTitle}</h3>
      <p>${s.noBookingsBody}</p>
      <div class="qr">${qrSvg(link, { title: s.scanToBook })}</div>
      <div>
        <a class="walink" href="${link}" target="_blank" rel="noopener">
          ${WA_ICON} +${bookingNumber}
        </a>
      </div>
    </div>
  `;
}

// ---- the live region (what the poll replaces) ----

export function queueBody(opts: {
  /** Dialable number for the QR — the clinic's, not the doctor's own. */
  bookingNumber: string | null;
  doctor: ConsoleDoctor;
  rows: QueueRow[];
  queue: QueueState;
  avgWaitMins: number | null;
  csrfToken: string;
  now?: Date;
}): RawHtml {
  const { doctor, rows, queue, avgWaitMins, csrfToken } = opts;
  const now = opts.now ?? new Date();
  const language = doctor.defaultLanguage;
  const s = c(language);

  // Calling someone in out of turn can leave more than one patient in progress
  // — nothing forces the previous one to be closed first. The hero shows the
  // most recently called, because that is who the doctor just summoned, and any
  // others still render as rows below so a patient can never be stuck
  // in-progress and invisible.
  const inProgress = rows
    .filter((r) => r.status === 'IN_PROGRESS')
    .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));
  const serving = inProgress[0];
  const alsoInRoom = inProgress.slice(1);

  // One grouping, shared with the counters, so the list and the numbers above
  // it can never disagree again.
  const inRoom = rows.filter((r) => sectionFor(r.status as AppointmentStatus) === 'IN_ROOM');

  // Waiting runs by token — that is the order the desk calls people in.
  const waitingRows = rows
    .filter((r) => sectionFor(r.status as AppointmentStatus) === 'WAITING')
    .sort((a, b) => (a.tokenNumber ?? Infinity) - (b.tokenNumber ?? Infinity));

  // Expected runs by appointment time, which is the order they will show up.
  const expectedRows = rows
    .filter((r) => sectionFor(r.status as AppointmentStatus) === 'EXPECTED')
    .sort(
      (a, b) =>
        (a.slotStart?.getTime() ?? a.tokenNumber ?? 0) -
        (b.slotStart?.getTime() ?? b.tokenNumber ?? 0),
    );

  const closedRows = rows.filter(
    (r) => sectionFor(r.status as AppointmentStatus) === 'CLOSED',
  );

  // Call next takes the first person actually in the room's waiting area.
  const next = waitingRows[0];
  const anyToday = rows.length > 0;

  // Two columns on a desk screen: what you act on stays put on the left while
  // the list scrolls on the right. One column below 1024px, where stacking is
  // the only thing that fits.
  return html`
    <div class="queue-2col">
      <div class="col-live">
        ${hero({ serving, s, language, now })}
        ${primaryCta({ serving, next, s, language, csrfToken })}
        ${stats({ queue, avgWaitMins, s, language })}
        ${queue.delayMins > 0
          ? html`<div class="caveat">${s.delayActive(queue.delayMins)}</div>`
          : ''}
        ${queue.isClosed ? html`<div class="caveat">${s.listClosed}</div>` : ''}
        <div class="walkin-bar">
          <a href="/app/queue/walk-in"
            ><button class="secondary" type="button">+ ${s.addWalkIn}</button></a
          >
        </div>
      </div>
      <div class="col-list">
    ${anyToday
      ? html`
          ${section({
            title: s.sectionInRoom,
            rows: inRoom,
            empty: null,
            s,
            language,
            timezone: doctor.timezone,
            csrfToken,
            now,
          })}
          ${section({
            title: s.sectionWaiting,
            rows: waitingRows,
            empty: s.waitingNone,
            s,
            language,
            timezone: doctor.timezone,
            csrfToken,
            now,
          })}
          ${section({
            title: s.sectionExpected,
            rows: expectedRows,
            empty: s.expectedNone,
            s,
            language,
            timezone: doctor.timezone,
            csrfToken,
            now,
          })}
          ${closedRows.length > 0
            ? html`<details class="card closed-section">
                <summary>${s.sectionClosed} (${String(closedRows.length)})</summary>
                <div class="flush">
                  ${closedRows.map((row) =>
                    queueCard({
                      row,
                      s,
                      language,
                      timezone: doctor.timezone,
                      csrfToken,
                      now,
                    }),
                  )}
                </div>
              </details>`
            : ''}
        `
      : html`<div class="card">${emptyState(opts.bookingNumber, s)}</div>`}
      </div>
    </div>
  `;
}

/**
 * Booking a patient who is at the desk or on the phone rather than on WhatsApp.
 * Most clinic volume arrives this way, and without it the queue on screen would
 * not match the queue in the room.
 *
 * A number is required because the token is only worth having if the patient
 * can be told when their turn comes — that is the whole product. The desk can
 * take a relative's number for a patient without a phone.
 */
export function walkInPage(opts: {
  doctor: ConsoleDoctor;
  queueCount: number;
  csrfToken: string;
  values?: { name?: string; phone?: string; language?: string; notes?: string };
  error?: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const v = opts.values ?? {};
  const navOpts = {
    clinicName: opts.doctor.clinicName,
    doctorName: opts.doctor.name,
    current: 'queue' as const,
    queueCount: opts.queueCount,
    csrfToken: opts.csrfToken,
    s,
    photo: opts.doctor.photo,
    specialty: opts.doctor.specialty,
    bookingMode: opts.doctor.bookingMode,
    ...(opts.doctor.clinicDoctors ? { clinicDoctors: opts.doctor.clinicDoctors } : {}),
  };

  return page(
    { title: s.addWalkIn, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(navOpts)}
      <main>
        <div class="card">
          <h2>${s.addWalkIn}</h2>
          <p class="sub">${s.addWalkInSub}</p>
          ${opts.error ? html`<div class="err">${opts.error}</div>` : ''}

          <form method="post" action="/app/queue/walk-in">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />

            <label for="wname">${s.patientNameLabel}</label>
            <input id="wname" name="name" type="text" value="${v.name ?? ''}" autofocus required />

            <label for="wphone">${s.patientPhoneLabel}</label>
            <input
              id="wphone"
              name="phone"
              type="text"
              inputmode="numeric"
              value="${v.phone ?? ''}"
              placeholder="919876543210"
              required
            />
            <p class="hint">${s.phoneHint}</p>

            <label for="wnotes">${s.notesLabel} <span class="hint">${s.notesHint}</span></label>
            <textarea
              id="wnotes"
              name="notes"
              rows="2"
              maxlength="500"
              placeholder="${s.notesPlaceholder}"
            >${v.notes ?? ''}</textarea>

            <label for="wlang">${s.languageForPatient}</label>
            <select id="wlang" name="language">
              ${['EN', 'KN'].map(
                (l) =>
                  html`<option value="${l}" ${(v.language ?? opts.doctor.defaultLanguage) === l ? 'selected' : ''}>
                    ${l === 'KN' ? 'ಕನ್ನಡ' : 'English'}
                  </option>`,
              )}
            </select>

            <div class="actions" style="margin-top:18px">
              <button type="submit">${s.issueToken}</button>
              <a href="/app/queue"
                ><button class="secondary" type="button">${s.cancel}</button></a
              >
            </div>
          </form>
        </div>
      </main>
      ${doctorBottomNav(navOpts)}
    `,
  );
}

// ---- running late sheet ----

function delaySheet(opts: {
  s: ConsoleStrings;
  waiting: number;
  csrfToken: string;
  doctorName: string;
}): RawHtml {
  const { s, waiting, csrfToken, doctorName } = opts;
  return html`
    <details class="card">
      <summary style="cursor:pointer;font-weight:650;list-style:none;min-height:44px;display:flex;align-items:center">
        ${s.runningLate}
      </summary>
      <p class="sub" style="margin-top:12px">${s.runningLateSub}</p>

      <form method="post" action="/app/queue/delay">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <div class="chips" role="group" aria-label="${s.runningLate}">
          ${[10, 15, 30].map(
            (m) => html`
              <button
                class="chip"
                type="submit"
                name="delayMins"
                value="${m}"
                formaction="/app/queue/delay/confirm"
              >
                +${m}
              </button>
            `,
          )}
        </div>

        <label for="customDelay">${s.customMinutes}</label>
        <div class="row">
          <div>
            <input
              id="customDelay"
              name="delayMins"
              type="number"
              min="1"
              max="480"
              inputmode="numeric"
              placeholder="45"
            />
          </div>
          <div style="flex:0 0 auto">
            <button class="secondary" type="submit" formaction="/app/queue/delay/confirm">
              ${s.customMinutes}
            </button>
          </div>
        </div>

        <p class="hint" style="margin-top:12px">${s.willSendTo(waiting)} · Dr. ${doctorName}</p>
      </form>
    </details>
  `;
}

// ---- cancel a few patients ----

/**
 * Deliberately a sheet rather than a checkbox on each queue row.
 *
 * The rows live inside the polled region, so a tick would be wiped the next time
 * the queue refreshed — mid-selection, without explanation. Out here the list is
 * rendered once and stays put. It also keeps cancelling off the main flow, which
 * is calling the next patient.
 */
function cancelSelectedSheet(opts: {
  rows: QueueRow[];
  s: ConsoleStrings;
  language: Language;
  timezone: string;
  csrfToken: string;
}): RawHtml {
  const { rows, s, language, timezone, csrfToken } = opts;
  if (rows.length === 0) return html``;

  return html`
    <details class="card">
      <summary style="cursor:pointer;font-weight:650;list-style:none;min-height:44px;display:flex;align-items:center">
        ${s.cancelSelected}
      </summary>
      <p class="sub" style="margin-top:12px">${s.cancelSelectedSub}</p>

      <form method="post" action="/app/queue/cancel/confirm">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <div class="picklist">
          ${rows.map(
            (row) => html`
              <label class="pick">
                <input type="checkbox" name="appointmentId" value="${row.appointmentId}" />
                <span class="who">
                  <span class="nm">${personName(row.patient.name, language)}</span>
                  <span class="sub"
                    >${row.tokenNumber !== null ? html`#${row.tokenNumber}` : ''}
                    ${row.slotStart ? timeOnly(row.slotStart, timezone) : ''}</span
                  >
                </span>
              </label>
            `,
          )}
        </div>
        <button class="secondary" type="submit">${s.cancelSelected}</button>
      </form>
    </details>
  `;
}

// ---- emergency: close today ----

/**
 * Deliberately a separate sheet from "running late", and below it: a delay is
 * routine, walking out is not. Posts to the same confirm step the settings date
 * picker uses, so there is one cancellation path rather than two.
 */
function closeTodaySheet(opts: {
  s: ConsoleStrings;
  today: string;
  csrfToken: string;
}): RawHtml {
  const { s, today, csrfToken } = opts;
  return html`
    <details class="card">
      <summary style="cursor:pointer;font-weight:650;list-style:none;min-height:44px;display:flex;align-items:center">
        ${s.closeToday}
      </summary>
      <p class="sub" style="margin-top:12px">${s.closeTodaySub}</p>

      <form method="post" action="/app/day/close/confirm">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="hidden" name="date" value="${today}" />
        <button class="secondary" type="submit">${s.closeToday}</button>
      </form>
    </details>
  `;
}

/** Step two: show the exact text and recipient count before anything is sent. */
export function delayConfirmPage(opts: {
  doctor: ConsoleDoctor;
  delayMins: number;
  recipients: number;
  messagePreview: string;
  csrfToken: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const navOpts = {
    clinicName: opts.doctor.clinicName,
    doctorName: opts.doctor.name,
    current: 'queue' as const,
    queueCount: opts.recipients,
    csrfToken: opts.csrfToken,
    s,
    photo: opts.doctor.photo,
    specialty: opts.doctor.specialty,
    bookingMode: opts.doctor.bookingMode,
    ...(opts.doctor.clinicDoctors ? { clinicDoctors: opts.doctor.clinicDoctors } : {}),
  };
  return page(
    { title: s.runningLate, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(navOpts)}
      <main>
        <div class="card">
          <h2>${s.runningLate}</h2>
          <p class="sub">${s.delayActive(opts.delayMins)}</p>

          <div class="hint">${s.messagePreview}</div>
          <div class="preview">${opts.messagePreview}</div>

          <p style="font-weight:600">${s.willSendTo(opts.recipients)}</p>

          <form method="post" action="/app/queue/delay">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            <input type="hidden" name="delayMins" value="${opts.delayMins}" />
            <div class="actions">
              <button type="submit" ${opts.recipients === 0 ? 'disabled' : ''}>
                ${s.announceDelay}
              </button>
              <a href="/app/queue"><button class="secondary" type="button">${s.cancel}</button></a>
            </div>
          </form>
        </div>
      </main>
      ${doctorBottomNav(navOpts)}
    `,
  );
}

const POLL = `
// Swap only the live region, so scroll position and any open sheet survive.
// Pauses on a hidden tab; a failed poll is skipped and the next one re-syncs.
(function(){
  var region=document.getElementById('live');
  var stamp=document.getElementById('stamp');
  if(!region) return;
  var last=Date.now(), labels=JSON.parse(region.dataset.labels||'{}');

  function tick(){
    if(!stamp) return;
    var s=Math.round((Date.now()-last)/1000);
    stamp.textContent = s<5 ? labels.just
      : s<60 ? labels.ago.replace('{t}', s+'s')
      : labels.ago.replace('{t}', Math.round(s/60)+'m');
  }
  setInterval(tick,1000);

  async function refresh(){
    if(document.hidden) return;
    try{
      var r=await fetch(location.pathname+'?fragment=1',{headers:{'x-requested-with':'fetch'}});
      if(!r.ok) return;
      region.innerHTML=await r.text();
      last=Date.now(); tick();
    }catch(e){}
  }
  setInterval(refresh,30000);
  document.addEventListener('visibilitychange',function(){ if(!document.hidden) refresh(); });
})();
`;

export function queuePageV2(opts: {
  /** Dialable number for the QR — the clinic's, not the doctor's own. */
  bookingNumber: string | null;
  doctor: ConsoleDoctor;
  rows: QueueRow[];
  queue: QueueState;
  avgWaitMins: number | null;
  onLeave: boolean;
  /** Today in the clinic's timezone, YYYY-MM-DD — what the close sheet posts. */
  today: string;
  csrfToken: string;
  flash?: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const labels = JSON.stringify({ just: s.justNow, ago: s.updatedAgo('{t}') });
  const navOpts = {
    clinicName: opts.doctor.clinicName,
    doctorName: opts.doctor.name,
    current: 'queue' as const,
    queueCount: opts.queue.waiting,
    csrfToken: opts.csrfToken,
    s,
    photo: opts.doctor.photo,
    specialty: opts.doctor.specialty,
    bookingMode: opts.doctor.bookingMode,
    ...(opts.doctor.clinicDoctors ? { clinicDoctors: opts.doctor.clinicDoctors } : {}),
  };

  return page(
    { title: s.queue, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(navOpts)}
      <main class="wide">
        ${opts.flash ? html`<div class="ok">${opts.flash}</div>` : ''}
        ${opts.onLeave ? html`<div class="caveat">${s.onLeave}</div>` : ''}
        ${/* Phrased as what it means for the doctor, not the provider's error
             code — they can act on "patients are not receiving updates", not on
             "#141006". The operator console carries the technical detail. */ ''}
        ${opts.doctor.channelStatus === 'BLOCKED' || opts.doctor.channelStatus === 'UNKNOWN'
          ? html`<div class="err">${s.channelBlocked}</div>`
          : opts.doctor.channelStatus === 'LIMITED'
            ? html`<div class="caveat">${s.channelLimited}</div>`
            : ''}

        <div class="live" style="margin-bottom:12px">
          <span class="dot beat" aria-hidden="true"></span>
          <span id="stamp">${s.justNow}</span>
        </div>

        <div id="live" data-labels="${labels}">
          ${queueBody({
            bookingNumber: opts.bookingNumber,
            doctor: opts.doctor,
            rows: opts.rows,
            queue: opts.queue,
            avgWaitMins: opts.avgWaitMins,
            csrfToken: opts.csrfToken,
          })}
        </div>

        ${delaySheet({
          s,
          waiting: opts.queue.waiting,
          csrfToken: opts.csrfToken,
          doctorName: opts.doctor.name,
        })}

        ${opts.onLeave
          ? ''
          : html`
              ${cancelSelectedSheet({
                // Anything still standing can be cancelled, including whoever is
                // in the room — a doctor cutting the list short means them too.
                rows: opts.rows.filter((r) =>
                  ['BOOKED', 'ARRIVED', 'IN_PROGRESS'].includes(r.status),
                ),
                s,
                language: opts.doctor.defaultLanguage,
                timezone: opts.doctor.timezone,
                csrfToken: opts.csrfToken,
              })}
              ${closeTodaySheet({ s, today: opts.today, csrfToken: opts.csrfToken })}
            `}
      </main>
      ${doctorBottomNav(navOpts)}
    `,
    html`<script>
      ${raw(POLL)}
    </script>`,
  );
}
