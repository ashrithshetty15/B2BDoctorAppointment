import type { Doctor, Language } from '@prisma/client';
import { type ConsoleStrings, c, elapsed } from '../../i18n/console';
import type { QueueRow, QueueState } from './doctorViews';
import { type RawHtml, html, page, raw } from './layout';
import { doctorBottomNav, doctorHeader } from './nav';
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
function waitingSince(row: QueueRow): Date | null {
  return row.arrivedAt ?? row.bookedAt ?? null;
}

function waitedMins(row: QueueRow, now: Date): number {
  const since = waitingSince(row);
  return since ? Math.floor((now.getTime() - since.getTime()) / 60_000) : 0;
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
function waitingRow(opts: {
  row: QueueRow;
  s: ConsoleStrings;
  language: Language;
  timezone: string;
  csrfToken: string;
  now: Date;
  roomBusy: boolean;
}): RawHtml {
  const { row, s, language, timezone, csrfToken, now, roomBusy } = opts;
  const mins = waitedMins(row, now);
  const overdue = mins >= OVERDUE_MINS;
  const since = waitingSince(row);

  const act = (status: string, label: string, cls: string) => html`
    <form method="post" action="/app/queue/${row.appointmentId}/status">
      <input type="hidden" name="_csrf" value="${csrfToken}" />
      <input type="hidden" name="status" value="${status}" />
      <button class="${cls}" type="submit">${label}</button>
    </form>
  `;

  return html`
    <div class="qrow ${overdue ? 'overdue' : ''}">
      <div class="tok">${row.tokenNumber}</div>
      <div class="body">
        <div class="nm">${personName(row.patient.name, language)}</div>
        <div class="sub">
          ${row.status === 'ARRIVED'
            ? html`<span class="pill arrived">${s.arrived}</span>`
            : ''}
          ${since
            ? html`<span class="waited ${overdue ? 'over' : ''}"
                >${s.waitedFor(elapsed(since, language, now))}</span
              >`
            : ''}
          ${row.bookedAt
            ? html`<span>${s.bookedAt(timeOnly(row.bookedAt, timezone))}</span>`
            : ''}
          <span class="wa">${WA_ICON}${s.viaWhatsapp}</span>
        </div>
      </div>
      <div class="acts">
        ${row.status === 'BOOKED' ? act('arrived', s.arrived, 'ghost') : ''}
        ${roomBusy ? '' : act('in-progress', s.callIn, 'secondary')}
        ${act('no-show', s.noShow, 'ghost')}
      </div>
    </div>
  `;
}

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
      </div>
      <div class="acts">
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

// ---- empty state ----

function emptyState(doctor: Doctor, s: ConsoleStrings): RawHtml {
  if (!doctor.whatsappNumber) {
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

  const link = bookingLink(doctor.whatsappNumber);
  return html`
    <div class="empty">
      <h3>${s.noBookingsTitle}</h3>
      <p>${s.noBookingsBody}</p>
      <div class="qr">${qrSvg(link, { title: s.scanToBook })}</div>
      <div>
        <a class="walink" href="${link}" target="_blank" rel="noopener">
          ${WA_ICON} +${doctor.whatsappNumber}
        </a>
      </div>
    </div>
  `;
}

// ---- the live region (what the poll replaces) ----

export function queueBody(opts: {
  doctor: Doctor;
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

  const waitingRows = rows
    .filter((r) => r.status === 'BOOKED' || r.status === 'ARRIVED')
    .sort((a, b) => (a.tokenNumber ?? 0) - (b.tokenNumber ?? 0));
  const next = waitingRows[0];
  const anyToday = rows.length > 0;

  return html`
    ${hero({ serving, s, language, now })}
    ${primaryCta({ serving, next, s, language, csrfToken })}
    ${stats({ queue, avgWaitMins, s, language })}
    ${queue.delayMins > 0
      ? html`<div class="caveat">${s.delayActive(queue.delayMins)}</div>`
      : ''}
    ${queue.isClosed ? html`<div class="caveat">${s.listClosed}</div>` : ''}
    ${anyToday
      ? html`
          <div class="card flush">
            ${serving ? servingRow({ row: serving, s, language, csrfToken }) : ''}
            ${alsoInRoom.map((row) => servingRow({ row, s, language, csrfToken }))}
            ${waitingRows.map((row) =>
              waitingRow({
                row,
                s,
                language,
                timezone: doctor.timezone,
                csrfToken,
                now,
                roomBusy: serving !== undefined,
              }),
            )}
            ${serving && waitingRows.length > 0
              ? html`<div class="qrow"><div class="body hint">${s.oneAtATime}</div></div>`
              : ''}
            ${waitingRows.length === 0 && !serving
              ? html`<div class="qrow"><div class="body muted">${s.nobodyWaiting}</div></div>`
              : ''}
          </div>
        `
      : html`<div class="card">${emptyState(doctor, s)}</div>`}
  `;
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

/** Step two: show the exact text and recipient count before anything is sent. */
export function delayConfirmPage(opts: {
  doctor: Doctor;
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
  };
  return page(
    { title: s.runningLate, csrfToken: opts.csrfToken },
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
  doctor: Doctor;
  rows: QueueRow[];
  queue: QueueState;
  avgWaitMins: number | null;
  onLeave: boolean;
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
  };

  return page(
    { title: s.queue, csrfToken: opts.csrfToken },
    html`
      ${doctorHeader(navOpts)}
      <main>
        ${opts.flash ? html`<div class="ok">${opts.flash}</div>` : ''}
        ${opts.onLeave ? html`<div class="caveat">${s.onLeave}</div>` : ''}

        <div class="live" style="margin-bottom:12px">
          <span class="dot beat" aria-hidden="true"></span>
          <span id="stamp">${s.justNow}</span>
        </div>

        <div id="live" data-labels="${labels}">
          ${queueBody({
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
      </main>
      ${doctorBottomNav(navOpts)}
    `,
    html`<script>
      ${raw(POLL)}
    </script>`,
  );
}
