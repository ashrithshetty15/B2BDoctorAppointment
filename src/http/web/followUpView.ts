import type { Doctor } from '@prisma/client';
import { c } from '../../i18n/console';
import {
  FOLLOW_UP_PRESETS,
  type FollowUpFunnel,
  type FollowUpRow,
  presetLabel,
} from '../../domain/followUp';
import { raw, type RawHtml, html, page } from './layout';
import { doctorBottomNav, doctorHeader } from './nav';

/**
 * Follow-ups: setting one during a consult, and the worklist of who is due.
 *
 * Setting it is a page of its own rather than a sheet on the queue row. The
 * queue replaces its live region every 30 seconds, which would collapse an open
 * sheet mid-decision; out here the doctor's choice survives.
 */

function navFor(doctor: Doctor, current: 'queue' | 'patients', queueCount: number, csrf: string) {
  return {
    clinicName: doctor.clinicName,
    doctorName: doctor.name,
    current,
    queueCount,
    csrfToken: csrf,
    s: c(doctor.defaultLanguage),
    photo: doctor.photo,
    specialty: doctor.specialty,
    bookingMode: doctor.bookingMode,
  };
}

function personName(name: string | null): string {
  return name && name.trim() ? name : 'Unknown';
}

export function setFollowUpPage(opts: {
  doctor: Doctor;
  appointmentId: string;
  patientName: string | null;
  /** Already formatted in the caller's locale. */
  currentDue: string | null;
  /** YYYY-MM-DD floor for the date field: a follow-up is never in the past. */
  minDate: string;
  back: string;
  queueCount: number;
  csrfToken: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const nav = navFor(opts.doctor, 'queue', opts.queueCount, opts.csrfToken);

  return page(
    { title: s.followUp, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(nav)}
      <main>
        <div class="card">
          <h2>${s.followUp}</h2>
          <p class="sub">${personName(opts.patientName)} — ${s.followUpSub}</p>

          ${opts.currentDue
            ? html`<div class="ok">${s.followUpDueOn(opts.currentDue)}</div>`
            : ''}

          <form method="post" action="/app/appointment/${opts.appointmentId}/followup">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            <input type="hidden" name="back" value="${opts.back}" />

            <div class="chips" role="group" aria-label="${s.setFollowUp}">
              ${FOLLOW_UP_PRESETS.map(
                (p) => html`
                  <button class="chip" type="submit" name="preset" value="${p.key}">
                    ${presetLabel(p.key, opts.doctor.defaultLanguage)}
                  </button>
                `,
              )}
            </div>

            <label for="followUpDate">${s.orPickDate}</label>
            <div class="row">
              <div>
                <input id="followUpDate" name="date" type="date" min="${opts.minDate}" />
              </div>
              <div style="flex:0 0 auto">
                <button class="secondary" type="submit">${s.setFollowUp}</button>
              </div>
            </div>
          </form>

          ${opts.currentDue
            ? html`
                <form method="post" action="/app/appointment/${opts.appointmentId}/followup/clear">
                  <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
                  <input type="hidden" name="back" value="${opts.back}" />
                  <button class="ghost" type="submit">${s.clearFollowUp}</button>
                </form>
              `
            : ''}

          <a href="${opts.back}"><button class="secondary" type="button">${s.cancel}</button></a>
        </div>
      </main>
      ${doctorBottomNav(nav)}
    `,
  );
}

/**
 * One row in the due / upcoming lists.
 *
 * A div rather than a link wrapping everything: the row needs two destinations —
 * the patient's history and a tel: dial — and an anchor inside an anchor is
 * invalid HTML that browsers silently unnest, breaking the phone link.
 */
function followUpRow(row: FollowUpRow, dueLabel: string, seenLabel: string): RawHtml {
  return html`
    <div class="prow">
      <span class="body">
        <a class="nm" href="/app/patients/${row.patientId}">${personName(row.patientName)}</a>
        <span class="sub">
          <span>${dueLabel}</span>
          <span>${seenLabel}</span>
          ${/* Inline rather than a right-hand column: with a remark below, a
               vertically centred phone number floats oddly against a tall row. */ ''}
          <a class="tel" href="tel:+${row.patientPhone}">+${row.patientPhone}</a>
        </span>
        ${row.notes ? html`<p class="notetext">${row.notes}</p>` : ''}
      </span>
    </div>
  `;
}

/**
 * Did the reminders work?
 *
 * Three numbers narrowing to one, because the argument for this feature is a
 * sentence — we sent 40, 18 people tapped, 14 came back — and a clinic owner
 * can check the last of those against their own day.
 *
 * The fee is a field rather than a stored setting. It is the doctor's own
 * number, it differs by consult type, and asking them to type it once is
 * cheaper than a settings row, a migration and a form. It multiplies in the
 * browser, so the figure moves as they type — which is what makes it land in a
 * demo.
 */
function funnelPanel(
  funnel: FollowUpFunnel,
  days: number,
  s: ReturnType<typeof c>,
): RawHtml {
  if (funnel.sent === 0) {
    return html`
      <div class="card">
        <h3>${s.followUpResults}</h3>
        <p class="sub">${s.followUpNoneYet}</p>
      </div>
    `;
  }

  return html`
    <div class="card funnel">
      <h3>${s.followUpResults}</h3>
      <p class="sub">${s.followUpResultsSub(days)}</p>

      <div class="fsteps">
        <div class="fstep">
          <span class="fnum">${String(funnel.sent)}</span>
          <span class="flabel">${s.followUpSent}</span>
        </div>
        <div class="fstep">
          <span class="fnum">${String(funnel.tapped)}</span>
          <span class="flabel">${s.followUpTapped}</span>
        </div>
        <div class="fstep win">
          <span class="fnum">${String(funnel.booked)}</span>
          <span class="flabel">${s.followUpBooked}</span>
        </div>
      </div>

      <div class="fworth">
        <label for="fee">${s.followUpFeeLabel}</label>
        <span class="feewrap">
          <span aria-hidden="true">₹</span>
          <input id="fee" type="number" min="0" step="50" value="300" inputmode="numeric" />
        </span>
        <p
          class="fvalue"
          id="worth"
          data-booked="${String(funnel.booked)}"
          data-template="${s.followUpWorth('{}')}"
        ></p>
      </div>

      <p class="fnote">${s.followUpWorthNote}</p>
    </div>
  `;
}

/** Formats as Indian rupees: 1,20,000 rather than 120,000. */
const FUNNEL_SCRIPT = `
(function () {
  var fee = document.getElementById('fee');
  var out = document.getElementById('worth');
  if (!fee || !out) return;
  var booked = Number(out.getAttribute('data-booked')) || 0;
  var template = out.getAttribute('data-template') || '';
  function render() {
    var amount = booked * (Number(fee.value) || 0);
    var money = '\\u20B9' + amount.toLocaleString('en-IN');
    out.textContent = template.replace('{}', money);
  }
  fee.addEventListener('input', render);
  render();
})();
`;

export function followUpsPage(opts: {
  doctor: Doctor;
  due: (FollowUpRow & { dueLabel: string; seenLabel: string })[];
  upcoming: (FollowUpRow & { dueLabel: string; seenLabel: string })[];
  /** False until an approved WhatsApp template is configured. */
  canSend: boolean;
  /** Sent, tapped, booked — over the window below. */
  funnel: FollowUpFunnel;
  funnelDays: number;
  queueCount: number;
  csrfToken: string;
  flash?: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const nav = navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken);

  return page(
    { title: s.followUp, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(nav)}
      <main>
        ${opts.flash ? html`<div class="ok">${opts.flash}</div>` : ''}

        ${funnelPanel(opts.funnel, opts.funnelDays, s)}

        ${opts.canSend
          ? ''
          : // Stated plainly rather than letting the clinic assume reminders went
            // out. Until a template is approved these can only be phone calls.
            html`<div class="caveat">${s.followUpNotSending}</div>`}

        ${opts.due.length === 0 && opts.upcoming.length === 0
          ? html`
              <div class="card empty">
                <h3>${s.followUp}</h3>
                <p class="sub">${s.noFollowUps}</p>
              </div>
            `
          : html`
              ${opts.due.length > 0
                ? html`
                    <h3 class="secl">${s.followUpDue}</h3>
                    <div class="card flush">
                      ${opts.due.map((r) => followUpRow(r, r.dueLabel, r.seenLabel))}
                    </div>
                  `
                : ''}
              ${opts.upcoming.length > 0
                ? html`
                    <h3 class="secl">${s.followUpUpcoming}</h3>
                    <div class="card flush">
                      ${opts.upcoming.map((r) => followUpRow(r, r.dueLabel, r.seenLabel))}
                    </div>
                  `
                : ''}
            `}

        <a href="/app/patients"
          ><button class="secondary" type="button">${s.backToPatients}</button></a
        >
      </main>
      ${doctorBottomNav(nav)}
    `,
    html`<script>
      ${raw(FUNNEL_SCRIPT)}
    </script>`,
  );
}
