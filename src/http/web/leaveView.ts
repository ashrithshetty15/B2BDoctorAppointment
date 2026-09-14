import type { Doctor } from '@prisma/client';
import { c } from '../../i18n/console';
import { type RawHtml, html, page } from './layout';
import { doctorBottomNav, doctorHeader } from './nav';

/**
 * Closing a day: confirmation, then result.
 *
 * Follows the delay-broadcast pair — show the real patient message and the real
 * recipient count before anything irreversible happens. The difference is that a
 * cancellation has to admit who it will *fail* to reach, since WhatsApp refuses a
 * free-form message more than 24 hours after the patient last wrote in.
 */

/** A patient the doctor has to phone, because we cannot message them. */
export interface CallListEntry {
  name: string;
  phone: string;
  when: string;
}

function navFor(doctor: Doctor, queueCount: number, csrfToken: string) {
  return {
    clinicName: doctor.clinicName,
    doctorName: doctor.name,
    current: 'queue' as const,
    queueCount,
    csrfToken,
    s: c(doctor.defaultLanguage),
    photo: doctor.photo,
    specialty: doctor.specialty,
    bookingMode: doctor.bookingMode,
  };
}

function callList(entries: CallListEntry[]): RawHtml {
  return html`
    <ul class="calllist">
      ${entries.map(
        (p) => html`
          <li>
            <span class="nm">${p.name}</span>
            <span class="sub">${p.when}</span>
            <a class="tel" href="tel:+${p.phone}">+${p.phone}</a>
          </li>
        `,
      )}
    </ul>
  `;
}

export function closeDayConfirmPage(opts: {
  doctor: Doctor;
  /** YYYY-MM-DD, posted back on commit. */
  date: string;
  dateLabel: string;
  affected: number;
  reachable: number;
  unreachable: CallListEntry[];
  messagePreview: string;
  queueCount: number;
  csrfToken: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const nav = navFor(opts.doctor, opts.queueCount, opts.csrfToken);

  return page(
    { title: s.closeDay, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(nav)}
      <main>
        <div class="card">
          <h2>${s.closeDayFor(opts.dateLabel)}</h2>

          ${opts.affected === 0
            ? html`<p class="sub">${s.nothingBooked}</p>`
            : html`
                <p class="sub">${s.cancelsBookings(opts.affected)}</p>

                <div class="hint">${s.messagePreview}</div>
                <div class="preview">${opts.messagePreview}</div>

                <div class="reach">
                  ${opts.reachable > 0
                    ? html`<div class="r yes">
                        <span class="ic" aria-hidden="true">✓</span>
                        <span>${s.willBeMessaged(opts.reachable)}</span>
                      </div>`
                    : ''}
                  ${opts.unreachable.length > 0
                    ? html`<div class="r no">
                        <span class="ic" aria-hidden="true">!</span>
                        <span>
                          ${s.cannotBeMessaged(opts.unreachable.length)}
                          <br /><span class="sub">${s.cannotBeMessagedWhy}</span>
                        </span>
                      </div>`
                    : ''}
                </div>
              `}

          <form method="post" action="/app/day/close">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            <input type="hidden" name="date" value="${opts.date}" />
            <div class="actions">
              <button type="submit">${s.closeDayConfirm}</button>
              <a href="/app/queue"><button class="secondary" type="button">${s.cancel}</button></a>
            </div>
          </form>
        </div>
      </main>
      ${doctorBottomNav(nav)}
    `,
  );
}

/**
 * Rendered directly from the POST rather than redirected to, because the call
 * list cannot survive a flash string — and it is the one thing on this page the
 * doctor has to act on.
 */
export function closeDayResultPage(opts: {
  doctor: Doctor;
  dateLabel: string;
  cancelled: number;
  unreachable: CallListEntry[];
  queueCount: number;
  csrfToken: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const nav = navFor(opts.doctor, opts.queueCount, opts.csrfToken);

  return page(
    { title: s.dayClosed, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(nav)}
      <main>
        <div class="ok">${s.dayClosed} — ${opts.dateLabel}</div>

        <div class="card">
          <h2>${s.dayClosedSub(opts.cancelled)}</h2>

          ${opts.unreachable.length === 0
            ? html`<p class="sub">${s.everyoneNotified}</p>`
            : html`
                <div class="r no" style="margin-top:var(--s3)">
                  <span class="ic" aria-hidden="true">!</span>
                  <span>${s.callThesePatients}</span>
                </div>
                ${callList(opts.unreachable)}
                <p class="hint">${s.cannotBeMessagedWhy}</p>
              `}

          <a href="/app/queue"
            ><button class="secondary" type="button">${s.queue}</button></a
          >
        </div>
      </main>
      ${doctorBottomNav(nav)}
    `,
  );
}
