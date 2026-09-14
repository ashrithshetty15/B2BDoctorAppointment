import type { Doctor } from '@prisma/client';
import type { PatientRow, ReportSummary } from '../../domain/reports';
import { formatWait } from '../../utils/time';
import { c } from '../../i18n/console';
import { type RawHtml, html, initials, page, raw } from './layout';
import { type DoctorNavOptions, type DoctorTab, doctorBottomNav, doctorHeader } from './nav';
import { bookingLink, qrSvg } from './qr';

/** One row of the queue, already joined and position-computed by the caller. */
export interface QueueRow {
  appointmentId: string;
  status: string;
  type: string;
  tokenNumber: number | null;
  slotStart: Date | null;
  patient: { id: string; name: string | null; phone: string };
  /** When the patient booked — the appointment's createdAt. */
  bookedAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  consultMins: number | null;
  ahead?: number;
  etaMins?: number;
}

export interface QueueState {
  lastIssuedToken: number;
  nowServingToken: number | null;
  delayMins: number;
  isClosed: boolean;
  waiting: number;
}

/** Nav options for a doctor page; queueCount drives the live badge. */
function navFor(
  doctor: Doctor,
  current: DoctorTab,
  queueCount: number,
  csrfToken: string,
): DoctorNavOptions {
  return {
    clinicName: doctor.clinicName,
    doctorName: doctor.name,
    current,
    queueCount,
    csrfToken,
    s: c(doctor.defaultLanguage),
    photo: doctor.photo,
    specialty: doctor.specialty,
    bookingMode: doctor.bookingMode,
  };
}

function statusPill(status: string): RawHtml {
  return html`<span class="pill ${status.toLowerCase()}">${status.replace('_', ' ')}</span>`;
}

function personName(name: string | null): string {
  return name && name.trim() ? name : 'Unknown';
}

function timeOnly(at: Date | null, timezone: string): string {
  if (!at) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

export function bookingsPage(opts: {
  doctor: Doctor;
  rows: QueueRow[];
  queue: QueueState;
  date: string;
  prevDate: string;
  nextDate: string;
  isToday: boolean;
  isPast: boolean;
  dateLabel: string;
  queueCount: number;
  csrfToken: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  return page(
    {
      title: s.bookings,
      csrfToken: opts.csrfToken,
      bare: true,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'bookings', opts.queueCount, opts.csrfToken))}
      <main>
        <div class="datenav">
          <a href="/app/bookings?date=${opts.prevDate}"
            ><button class="secondary" type="button" style="margin:0">←</button></a
          >
          <span class="today">${opts.dateLabel}</span>
          <a href="/app/bookings?date=${opts.nextDate}"
            ><button class="secondary" type="button" style="margin:0">→</button></a
          >
          ${opts.isToday ? '' : html`<a href="/app/bookings">${s.backToToday}</a>`}
        </div>

        ${opts.rows.length > 0
          ? html`<div class="stats">
              <div class="s">
                <div class="n">${opts.rows.length}</div>
                <div class="l">${s.bookedCount}</div>
              </div>
              <div class="s">
                <div class="n">${opts.rows.filter((r) => r.status === 'DONE').length}</div>
                <div class="l">${s.seenCount}</div>
              </div>
              <div class="s">
                <div class="n">${opts.rows.filter((r) => r.status === 'NO_SHOW').length}</div>
                <div class="l">${s.noShow}</div>
              </div>
            </div>`
          : ''}
        ${opts.isToday
          ? html`<div class="caveat">${s.useQueueToday}</div>`
          : ''}
        ${opts.rows.length === 0
          ? html`<div class="card">
              <div class="empty">
                <h3>${s.noBookingsThisDay}</h3>
                <p>${s.noBookingsBody}</p>
              </div>
            </div>`
          : html`<div class="card flush">
              ${opts.rows.map(
                (r) => html`
                  <div class="slotrow ${r.status === 'CANCELLED' || r.status === 'NO_SHOW' ? 'past' : ''}">
                    <div class="slottime">
                      ${r.tokenNumber !== null
                        ? `#${r.tokenNumber}`
                        : timeOnly(r.slotStart, opts.doctor.timezone)}
                    </div>
                    <div class="body">
                      <div class="nm">
                        <a href="/app/patients/${r.patient.id}">${personName(r.patient.name)}</a>
                      </div>
                      <div class="sub">
                        ${statusPill(r.status)}
                        <span>${r.patient.phone}</span>
                        ${r.consultMins !== null
                          ? html`<span>${r.consultMins} min</span>`
                          : ''}
                      </div>
                    </div>
                  </div>
                `,
              )}
            </div>`}
      </main>
      ${doctorBottomNav(navFor(opts.doctor, 'bookings', opts.queueCount, opts.csrfToken))}
    `,
  );
}

export function patientsPage(opts: {
  doctor: Doctor;
  patients: PatientRow[];
  queueCount: number;
  csrfToken: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const link = opts.doctor.whatsappNumber ? bookingLink(opts.doctor.whatsappNumber) : null;

  return page(
    {
      title: s.patients,
      csrfToken: opts.csrfToken,
      bare: true,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
      <main>
      ${opts.patients.length === 0
        ? html`<div class="card">
            <div class="empty">
              <h3>${s.noPatientsTitle}</h3>
              <p>${s.noPatientsBody}</p>
              ${link
                ? html`<div class="qr">${qrSvg(link, { title: s.scanToBook })}</div>
                    <div>
                      <a class="walink" href="${link}" target="_blank" rel="noopener"
                        >+${opts.doctor.whatsappNumber}</a
                      >
                    </div>`
                : ''}
            </div>
          </div>`
        : html`
            <div class="stats">
              <div class="s">
                <div class="n">${opts.patients.length}</div>
                <div class="l">${s.patients}</div>
              </div>
              <div class="s">
                <div class="n">${opts.patients.filter((p) => p.visits > 1).length}</div>
                <div class="l">${s.returning}</div>
              </div>
            </div>

            <div class="card flush">
              ${opts.patients.map(
                (p) => html`
                  <a class="prow" href="/app/patients/${p.patientId}">
                    <span class="avatar" aria-hidden="true">${initials(p.name ?? '')}</span>
                    <span class="body">
                      <span class="nm">${personName(p.name)}</span>
                      <span class="sub">
                        <span>${p.phone}</span>
                        ${p.language === 'KN' ? html`<span class="pill">ಕನ್ನಡ</span>` : ''}
                      </span>
                    </span>
                    <span class="meta">
                      <span class="visits">${p.visits}</span>
                      <span class="l">${p.visits === 1 ? s.visitOne : s.visitMany}</span>
                      ${p.lastVisit
                        ? html`<span class="last"
                            >${p.lastVisit.toISOString().slice(0, 10)}</span
                          >`
                        : ''}
                    </span>
                  </a>
                `,
              )}
            </div>
          `}
      </main>
      ${doctorBottomNav(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
    `,
  );
}

export function patientDetailPage(opts: {
  doctor: Doctor;
  patient: { id: string; name: string | null; phone: string; language: string };
  appointments: {
    id: string;
    date: Date;
    status: string;
    tokenNumber: number | null;
    consultMins: number | null;
    arrivedAt: Date | null;
    startedAt: Date | null;
  }[];
  queueCount: number;
  csrfToken: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const done = opts.appointments.filter((a) => a.status === 'DONE').length;
  const noShow = opts.appointments.filter((a) => a.status === 'NO_SHOW').length;

  return page(
    {
      title: personName(opts.patient.name),
      csrfToken: opts.csrfToken,
      bare: true,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
      <main>
        <div class="card">
          <div class="phead">
            <span class="avatar lg" aria-hidden="true">${initials(opts.patient.name ?? '')}</span>
            <div style="min-width:0">
              <h2>${personName(opts.patient.name)}</h2>
              <p class="sub" style="margin:0">
                ${opts.patient.phone} ·
                ${opts.patient.language === 'KN' ? 'ಕನ್ನಡ' : 'English'}
              </p>
            </div>
          </div>
        </div>

        <div class="stats">
          <div class="s">
            <div class="n">${opts.appointments.length}</div>
            <div class="l">${s.bookings}</div>
          </div>
          <div class="s">
            <div class="n">${done}</div>
            <div class="l">${s.seenCount}</div>
          </div>
          <div class="s ${noShow > 0 ? 'busy' : ''}">
            <div class="n">${noShow}</div>
            <div class="l">${s.noShow}</div>
          </div>
        </div>

        <div class="card flush">

          ${opts.appointments.map(
            (a) => html`
              <div class="slotrow ${a.status === 'NO_SHOW' || a.status === 'CANCELLED' ? 'past' : ''}">
                <div class="slottime">${a.date.toISOString().slice(5, 10)}</div>
                <div class="body">
                  <div class="sub" style="margin:0">
                    ${statusPill(a.status)}
                    ${a.tokenNumber !== null ? html`<span>#${a.tokenNumber}</span>` : ''}
                    ${a.consultMins !== null ? html`<span>${a.consultMins} min</span>` : ''}
                  </div>
                </div>
              </div>
              `,
          )}
        </div>

        <a href="/app/patients"
          ><button class="secondary" type="button">${s.backToPatients}</button></a
        >
      </main>
      ${doctorBottomNav(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
    `,
  );
}

export function reportsPage(opts: {
  doctor: Doctor;
  report: ReportSummary;
  days: number;
  queueCount: number;
  csrfToken: string;
}): string {
  const r = opts.report;
  const s = c(opts.doctor.defaultLanguage);
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const maxDay = Math.max(1, ...r.perDay.map((d) => d.total));
  const maxHour = Math.max(1, ...r.busiestHours.map((h) => h.count));

  return page(
    {
      title: 'Reports',
      csrfToken: opts.csrfToken,
      bare: true,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'reports', opts.queueCount, opts.csrfToken))}
      <main>
      ${r.totals.total === 0
        ? html`<div class="card">
            <div class="empty">
              <h3>${s.noReportData}</h3>
              <p>${s.noReportBody}</p>
            </div>
          </div>`
        : ''}
      <div class="card" ${r.totals.total === 0 ? raw('hidden') : ''}>
        <h2>Reports</h2>
        <p class="sub">${r.from} to ${r.to}</p>
        <div class="datenav">
          ${[7, 30, 90].map((d) =>
            d === opts.days
              ? html`<strong>${d} days</strong>`
              : html`<a href="/app/reports?days=${d}">${d} days</a>`,
          )}
        </div>

        <div class="stats">
          <div class="s"><div class="n">${r.totals.total}</div><div class="l">Bookings</div></div>
          <div class="s"><div class="n">${r.totals.completed}</div><div class="l">Completed</div></div>
          <div class="s ${r.totals.noShow > 0 ? 'busy' : ''}">
            <div class="n">${r.totals.noShow}</div><div class="l">No-shows</div>
          </div>
          <div class="s"><div class="n">${r.totals.cancelled}</div><div class="l">Cancelled</div></div>
        </div>
      </div>

      <div class="card">
        <h2>Time</h2>
        <div class="stats">
          <div class="s">
            <div class="n">${r.consult.avgMins ?? '—'}${r.consult.avgMins !== null ? ' min' : ''}</div>
            <div class="l">Avg consult</div>
          </div>
          <div class="s">
            <div class="n">${r.consult.medianMins ?? '—'}${r.consult.medianMins !== null ? ' min' : ''}</div>
            <div class="l">Median consult</div>
          </div>
          <div class="s">
            <div class="n">${r.wait.avgMins ?? '—'}${r.wait.avgMins !== null ? ' min' : ''}</div>
            <div class="l">Avg wait</div>
          </div>
          <div class="s ${(r.wait.maxMins ?? 0) >= 30 ? 'busy' : ''}">
            <div class="n">${r.wait.maxMins ?? '—'}${r.wait.maxMins !== null ? ' min' : ''}</div>
            <div class="l">Longest wait</div>
          </div>
        </div>

        ${r.consult.completed > 0 && (r.consult.coverage ?? 1) < 1
          ? html`<div class="caveat">
              Consult length is only recorded when you tap <em>Call in</em> before
              <em>Done</em>. These averages cover ${r.consult.recorded} of
              ${r.consult.completed} completed visits (${pct(r.consult.coverage)}).
            </div>`
          : ''}
        ${r.consult.atCeiling > 0
          ? html`<div class="caveat">
              ${r.consult.atCeiling} consult${r.consult.atCeiling === 1 ? '' : 's'} recorded at the
              120-minute maximum — usually a <em>Done</em> tapped long after the patient left,
              rather than a real two-hour visit.
            </div>`
          : ''}
        ${r.wait.sampled === 0
          ? html`<div class="caveat">
              Wait time needs both <em>Arrived</em> and <em>Call in</em> to be tapped. No visits in
              this period had both.
            </div>`
          : ''}
      </div>

      <div class="card">
        <h2>Bookings per day</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Total</th>
              <th>Done</th>
              <th>No-show</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${r.perDay.map(
              (d) => html`
                <tr>
                  <td class="num">${d.date}</td>
                  <td class="num">${d.total}</td>
                  <td class="num">${d.done}</td>
                  <td class="num">${d.noShow}</td>
                  <td style="width:40%">
                    <div class="bar" style="width:${Math.round((d.total / maxDay) * 100)}%"></div>
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>

      ${r.busiestHours.length > 0
        ? html`
            <div class="card">
              <h2>Busiest hours</h2>
              <p class="sub">When consults actually started, in ${opts.doctor.timezone}</p>
              <table>
                <tbody>
                  ${r.busiestHours.map(
                    (h) => html`
                      <tr>
                        <td class="num" style="width:80px">
                          ${String(h.hour).padStart(2, '0')}:00
                        </td>
                        <td class="num" style="width:50px">${h.count}</td>
                        <td>
                          <div
                            class="bar"
                            style="width:${Math.round((h.count / maxHour) * 100)}%"
                          ></div>
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
          `
        : ''}

      <div class="card">
        <h2>Patients</h2>
        <div class="stats">
          <div class="s"><div class="n">${r.patients.unique}</div><div class="l">Unique</div></div>
          <div class="s"><div class="n">${r.patients.returning}</div><div class="l">Returning</div></div>
        </div>
        <p class="hint">
          Cancellations are not attributed — the system cannot tell a patient cancelling from a
          clinic-wide cancellation caused by leave.
        </p>
      </div>
      </main>
      ${doctorBottomNav(navFor(opts.doctor, 'reports', opts.queueCount, opts.csrfToken))}
    `,
  );
}
