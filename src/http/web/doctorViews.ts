import type { Doctor } from '@prisma/client';
import type { PatientRow, ReportSummary } from '../../domain/reports';
import { formatWait } from '../../utils/time';
import { c } from '../../i18n/console';
import { type RawHtml, html, page } from './layout';
import { type DoctorNavOptions, type DoctorTab, doctorBottomNav, doctorHeader } from './nav';

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

/**
 * The queue table, rendered on its own so the 30s poll can swap just this
 * element rather than re-rendering the page.
 */
export function queueTable(opts: {
  rows: QueueRow[];
  queue: QueueState;
  csrfToken: string;
  timezone: string;
  /** Past dates render without action buttons. */
  readOnly?: boolean;
}): RawHtml {
  const { rows, queue, csrfToken, timezone, readOnly } = opts;

  const action = (appointmentId: string, status: string, label: string, cls = 'secondary') => html`
    <form method="post" action="/app/queue/${appointmentId}/status">
      <input type="hidden" name="_csrf" value="${csrfToken}" />
      <input type="hidden" name="status" value="${status}" />
      <button class="${cls}" style="margin:0;padding:5px 11px;font-size:13px">${label}</button>
    </form>
  `;

  return html`
    <div class="stat">
      <div>
        <div class="n">${queue.nowServingToken ?? '—'}</div>
        <div class="l">Now serving</div>
      </div>
      <div>
        <div class="n">${queue.waiting}</div>
        <div class="l">Waiting</div>
      </div>
      <div>
        <div class="n">${queue.lastIssuedToken}</div>
        <div class="l">Issued today</div>
      </div>
      ${queue.delayMins > 0
        ? html`<div>
            <div class="n" style="color:var(--danger)">+${queue.delayMins}m</div>
            <div class="l">Announced delay</div>
          </div>`
        : ''}
    </div>

    ${queue.isClosed
      ? html`<div class="caveat">The list is closed for this day — no new tokens can be issued.</div>`
      : ''}
    ${rows.length === 0
      ? html`<p class="muted">No bookings for this day.</p>`
      : html`
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Patient</th>
                <th>Status</th>
                <th>Wait</th>
                <th>Arrived</th>
                ${readOnly ? html`<th>Consult</th>` : html`<th>Actions</th>`}
              </tr>
            </thead>
            <tbody>
              ${rows.map(
                (r) => html`
                  <tr>
                    <td class="num">
                      <strong
                        >${r.tokenNumber !== null
                          ? `#${r.tokenNumber}`
                          : timeOnly(r.slotStart, timezone)}</strong
                      >
                    </td>
                    <td>
                      <a href="/app/patients/${r.patient.id}">${personName(r.patient.name)}</a>
                      <div class="hint">${r.patient.phone}</div>
                    </td>
                    <td>${statusPill(r.status)}</td>
                    <td class="num">
                      ${r.etaMins !== undefined
                        ? html`${formatWait(r.etaMins)}${r.ahead
                            ? html`<div class="hint">${r.ahead} ahead</div>`
                            : ''}`
                        : html`<span class="muted">—</span>`}
                    </td>
                    <td class="num">${timeOnly(r.arrivedAt, timezone)}</td>
                    ${readOnly
                      ? html`<td class="num">
                          ${r.consultMins !== null
                            ? `${r.consultMins} min`
                            : html`<span class="muted">—</span>`}
                        </td>`
                      : html`<td>
                          <div class="actions">
                            ${r.status === 'BOOKED' ? action(r.appointmentId, 'arrived', 'Arrived') : ''}
                            ${r.status === 'BOOKED' || r.status === 'ARRIVED'
                              ? action(r.appointmentId, 'in-progress', 'Call in', '')
                              : ''}
                            ${r.status === 'IN_PROGRESS'
                              ? action(r.appointmentId, 'done', 'Done', '')
                              : ''}
                            ${r.status === 'BOOKED' || r.status === 'ARRIVED'
                              ? action(r.appointmentId, 'no-show', 'No show', 'danger')
                              : ''}
                            ${r.status === 'DONE' || r.status === 'NO_SHOW' || r.status === 'CANCELLED'
                              ? html`<span class="muted">—</span>`
                              : ''}
                          </div>
                        </td>`}
                  </tr>
                `,
              )}
            </tbody>
          </table>
        `}
  `;
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
  return page(
    {
      title: 'Bookings',
      csrfToken: opts.csrfToken,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'bookings', opts.queueCount, opts.csrfToken))}
      <main>
      <div class="card">
        <h2>Bookings</h2>
        <div class="datenav">
          <a href="/app/bookings?date=${opts.prevDate}"
            ><button class="secondary" type="button" style="margin:0">← Previous</button></a
          >
          <span class="today">${opts.dateLabel}</span>
          <a href="/app/bookings?date=${opts.nextDate}"
            ><button class="secondary" type="button" style="margin:0">Next →</button></a
          >
          ${opts.isToday ? '' : html`<a href="/app/bookings">Back to today</a>`}
        </div>
        ${opts.isToday
          ? html`<p class="sub">This is today — use <a href="/app/queue">Queue</a> to work it.</p>`
          : ''}
        ${queueTable({
          rows: opts.rows,
          queue: opts.queue,
          csrfToken: opts.csrfToken,
          timezone: opts.doctor.timezone,
          readOnly: opts.isPast || !opts.isToday,
        })}
      </div>
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
  return page(
    {
      title: 'Patients',
      csrfToken: opts.csrfToken,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
      <main>
      <div class="card">
        <h2>Patients</h2>
        <p class="sub">
          ${opts.patients.length} ${opts.patients.length === 1 ? 'person has' : 'people have'} booked
          with you
        </p>
        ${opts.patients.length === 0
          ? html`<p class="muted">No patients yet.</p>`
          : html`
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Visits</th>
                    <th>Last seen</th>
                    <th>Language</th>
                  </tr>
                </thead>
                <tbody>
                  ${opts.patients.map(
                    (p) => html`
                      <tr>
                        <td><a href="/app/patients/${p.patientId}">${personName(p.name)}</a></td>
                        <td class="num">${p.phone}</td>
                        <td class="num">${p.visits}</td>
                        <td class="num">
                          ${p.lastVisit ? p.lastVisit.toISOString().slice(0, 10) : '—'}
                        </td>
                        <td>${p.language === 'KN' ? 'ಕನ್ನಡ' : 'English'}</td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `}
      </div>
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
  const done = opts.appointments.filter((a) => a.status === 'DONE').length;
  const noShow = opts.appointments.filter((a) => a.status === 'NO_SHOW').length;

  return page(
    {
      title: personName(opts.patient.name),
      csrfToken: opts.csrfToken,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
      <main>
      <div class="card">
        <h2>${personName(opts.patient.name)}</h2>
        <p class="sub">
          ${opts.patient.phone} · ${opts.patient.language === 'KN' ? 'ಕನ್ನಡ' : 'English'}
        </p>

        <div class="stat">
          <div>
            <div class="n">${opts.appointments.length}</div>
            <div class="l">Bookings</div>
          </div>
          <div>
            <div class="n">${done}</div>
            <div class="l">Completed</div>
          </div>
          <div>
            <div class="n">${noShow}</div>
            <div class="l">No-shows</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Token</th>
              <th>Status</th>
              <th>Consult</th>
            </tr>
          </thead>
          <tbody>
            ${opts.appointments.map(
              (a) => html`
                <tr>
                  <td class="num">${a.date.toISOString().slice(0, 10)}</td>
                  <td class="num">${a.tokenNumber !== null ? `#${a.tokenNumber}` : '—'}</td>
                  <td>${statusPill(a.status)}</td>
                  <td class="num">
                    ${a.consultMins !== null
                      ? `${a.consultMins} min`
                      : html`<span class="muted">—</span>`}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>

        <a href="/app/patients"><button class="secondary" type="button">Back to patients</button></a>
      </div>
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
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const maxDay = Math.max(1, ...r.perDay.map((d) => d.total));
  const maxHour = Math.max(1, ...r.busiestHours.map((h) => h.count));

  return page(
    {
      title: 'Reports',
      csrfToken: opts.csrfToken,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'reports', opts.queueCount, opts.csrfToken))}
      <main>
      <div class="card">
        <h2>Reports</h2>
        <p class="sub">${r.from} to ${r.to}</p>
        <div class="datenav">
          ${[7, 30, 90].map((d) =>
            d === opts.days
              ? html`<strong>${d} days</strong>`
              : html`<a href="/app/reports?days=${d}">${d} days</a>`,
          )}
        </div>

        <div class="stat">
          <div><div class="n">${r.totals.total}</div><div class="l">Bookings</div></div>
          <div><div class="n">${r.totals.completed}</div><div class="l">Completed</div></div>
          <div><div class="n">${r.totals.noShow}</div><div class="l">No-shows</div></div>
          <div><div class="n">${r.totals.cancelled}</div><div class="l">Cancelled</div></div>
          <div><div class="n">${pct(r.noShowRate)}</div><div class="l">No-show rate</div></div>
        </div>
      </div>

      <div class="card">
        <h2>Time</h2>
        <div class="stat">
          <div>
            <div class="n">${r.consult.avgMins ?? '—'}${r.consult.avgMins !== null ? ' min' : ''}</div>
            <div class="l">Avg consult</div>
          </div>
          <div>
            <div class="n">${r.consult.medianMins ?? '—'}${r.consult.medianMins !== null ? ' min' : ''}</div>
            <div class="l">Median consult</div>
          </div>
          <div>
            <div class="n">${r.wait.avgMins ?? '—'}${r.wait.avgMins !== null ? ' min' : ''}</div>
            <div class="l">Avg wait</div>
          </div>
          <div>
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
        <div class="stat">
          <div><div class="n">${r.patients.unique}</div><div class="l">Unique</div></div>
          <div><div class="n">${r.patients.returning}</div><div class="l">Returning</div></div>
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
