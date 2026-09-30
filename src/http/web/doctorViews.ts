import { DateTime } from 'luxon';
import type { Doctor } from '@prisma/client';
import type { PatientRow, ReportSummary } from '../../domain/reports';
import { formatDateForPatient, formatWait } from '../../utils/time';
import { type ConsoleStrings, c } from '../../i18n/console';
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
  /** Staff-only remark; never shown to the patient. */
  notes: string | null;
  /** WHATSAPP | WALK_IN — recorded at booking, never inferred. */
  source: string;
  ahead?: number;
  etaMins?: number;
}

export interface QueueState {
  /** People on today's list, whatever they booked through. */
  lastIssuedToken: number;
  nowServingToken: number | null;
  delayMins: number;
  isClosed: boolean;
  /** ARRIVED — actually in the waiting room. */
  waiting: number;
  /** BOOKED — due today but not here yet. */
  expected: number;
}

/** Nav options for a doctor page; queueCount drives the live badge. */
function navFor(
  doctor: Doctor & { clinicDoctors?: Array<{ id: string; name: string; specialty: string | null }> },
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
    ...(doctor.clinicDoctors ? { clinicDoctors: doctor.clinicDoctors } : {}),
    s: c(doctor.defaultLanguage),
    photo: doctor.photo,
    specialty: doctor.specialty,
    bookingMode: doctor.bookingMode,
  };
}

export function statusPill(status: string): RawHtml {
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
 * The QR and wa.me link an empty state offers.
 *
 * Shared because the copy beside it says "show this code at reception" — the
 * Bookings empty state printed that sentence with nothing under it, so the page
 * promised a code it never rendered.
 */
function bookingQr(bookingNumber: string | null, s: ConsoleStrings): RawHtml {
  if (!bookingNumber) return html``;
  const link = bookingLink(bookingNumber);
  return html`
    <div class="qr">${qrSvg(link, { title: s.scanToBook })}</div>
    <div>
      <a class="walink" href="${link}" target="_blank" rel="noopener">+${bookingNumber}</a>
    </div>
  `;
}

export function bookingsPage(opts: {
  /** Dialable number for the QR — the clinic's, not the doctor's own. */
  bookingNumber: string | null;
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
                <!--
                  Cancelled appointments are listed below, struck through, because
                  the desk wants the history — but they are not booked, and
                  counting every row made a day with 2 bookings and 1 cancellation
                  read as "3 Booked".

                  No-shows still count: they were booked, and the day's own tile
                  breaks them out, so "3 booked, 2 seen, 1 no-show" reconciles.
                -->
                <div class="n">${opts.rows.filter((r) => r.status !== 'CANCELLED').length}</div>
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
                ${bookingQr(opts.bookingNumber, s)}
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
  /** Drives the badge on the follow-ups link. */
  followUpsDue: number;
  queueCount: number;
  csrfToken: string;
  /** Dialable number for the QR — the clinic's, not the doctor's own. */
  bookingNumber: string | null;
}): string {
  const s = c(opts.doctor.defaultLanguage);

  return page(
    {
      title: s.patients,
      csrfToken: opts.csrfToken,
      bare: true,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
      <main>
      ${/* Follow-ups hang off Patients rather than taking a fifth nav tab. The
           badge is what makes a due list findable at all. */ ''}
      <div class="card flush">
        <a class="prow" href="/app/followups">
          <span class="body">
            <span class="nm">${s.followUp}</span>
            <span class="sub">${s.followUpListSub}</span>
          </span>
          <span class="meta">
            ${opts.followUpsDue > 0
              ? html`<span class="visits">${opts.followUpsDue}</span>
                  <span class="l">${s.followUpDue}</span>`
              : html`<span class="l">${s.followUpUpcoming}</span>`}
          </span>
        </a>
      </div>

      ${opts.patients.length === 0
        ? html`<div class="card">
            <div class="empty">
              <h3>${s.noPatientsTitle}</h3>
              <p>${s.noPatientsBody}</p>
              ${bookingQr(opts.bookingNumber, s)}
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

/** One document attached to a visit; the bytes themselves are never loaded here. */
export interface VisitDocument {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface VisitRow {
  id: string;
  date: Date;
  status: string;
  tokenNumber: number | null;
  slotStart: Date | null;
  consultMins: number | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  notes: string | null;
  followUpOn: Date | null;
  followUpSentAt: Date | null;
  documents: VisitDocument[];
}

/** "12 Sep", or "12 Sep 2025" once the year stops being the obvious one. */
function visitDate(date: Date, thisYear: number): string {
  const full = formatDateForPatient(date);
  const year = DateTime.fromJSDate(date, { zone: 'utc' }).year;
  return year === thisYear ? full : `${full} ${year}`;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function docIcon(contentType: string): string {
  return contentType === 'application/pdf' ? '📄' : '🖼️';
}

/**
 * Documents for one visit, plus the picker. The file is turned into a data: URI
 * by the script at the foot of the page — there is no multipart parser, and the
 * same trick already backs the profile photo.
 */
function documentsBlock(opts: {
  visit: VisitRow;
  s: ConsoleStrings;
  csrfToken: string;
  accept: string;
  hint: string;
}): RawHtml {
  const { visit, s, csrfToken } = opts;
  return html`
    ${visit.documents.length > 0
      ? html`<div class="docs">
          ${visit.documents.map(
            (d) => html`
              <div class="doc">
                <span class="ic" aria-hidden="true">${docIcon(d.contentType)}</span>
                <a class="nm" href="/app/document/${d.id}">${d.filename}</a>
                <span class="sz">${fileSize(d.sizeBytes)}</span>
                <form
                  method="post"
                  action="/app/document/${d.id}/delete"
                  onsubmit="return confirm('${s.confirmRemoveDocument}')"
                >
                  <input type="hidden" name="_csrf" value="${csrfToken}" />
                  <input type="hidden" name="back" value="/app/patients" />
                  <button class="del" type="submit">${s.removeDocument}</button>
                </form>
              </div>
            `,
          )}
        </div>`
      : ''}

    <details class="note up">
      <summary>${s.addDocument}</summary>
      <form method="post" action="/app/appointment/${visit.id}/document" class="docform">
        <input type="hidden" name="_csrf" value="${csrfToken}" />
        <input type="file" accept="${opts.accept}" data-doc-file />
        <input type="hidden" name="filename" data-doc-name />
        <input type="hidden" name="file" data-doc-data />
        <p class="hint">${opts.hint}</p>
        <button type="submit">${s.uploadDocument}</button>
      </form>
    </details>
  `;
}

/**
 * Encodes the chosen file into the form as a data: URI, downscaling images on
 * the way. The downscale is what makes this viable: a phone photo of a
 * prescription is several MB, and the /app body limit leaves room for ~400KB.
 *
 * PDFs pass through untouched, so a large one is rejected — the hint says so
 * rather than letting the doctor find out at submit time.
 */
const docScript = (maxBytes: number, maxLabel: string) => `
(function(){
  var MAX=${maxBytes}, LIMIT=${JSON.stringify(maxLabel)};
  document.querySelectorAll('form.docform').forEach(function(form){
    var file=form.querySelector('[data-doc-file]');
    var name=form.querySelector('[data-doc-name]');
    var data=form.querySelector('[data-doc-data]');
    if(!file||!name||!data) return;

    form.addEventListener('submit',function(e){
      if(!data.value){ e.preventDefault(); alert('Choose a file first.'); }
    });

    file.addEventListener('change',function(){
      var f=file.files&&file.files[0];
      data.value=''; name.value='';
      if(!f) return;
      if(!/^(image\\/(jpeg|png|webp)|application\\/pdf)$/.test(f.type)){
        alert('Please choose a JPG, PNG, WebP or PDF file.');
        file.value=''; return;
      }
      name.value=f.name;

      var reader=new FileReader();
      reader.onload=function(){
        if(f.type==='application/pdf'){
          if(f.size>MAX){
            alert('That PDF is too large. Please use one under '+LIMIT+'.');
            file.value=''; name.value=''; return;
          }
          data.value=reader.result; return;
        }
        var img=new Image();
        img.onload=function(){
          // Long edge to 1600px: legible for a report or a prescription, and
          // small enough to survive base64 through the form.
          var S=1600, w=img.width, h=img.height;
          if(w>S||h>S){ var r=Math.min(S/w,S/h); w=Math.round(w*r); h=Math.round(h*r); }
          var cv=document.createElement('canvas');
          cv.width=w; cv.height=h;
          cv.getContext('2d').drawImage(img,0,0,w,h);
          var q=0.85, out=cv.toDataURL('image/jpeg',q);
          // Step the quality down rather than rejecting a dense scan outright.
          while(out.length*0.75>MAX&&q>0.4){ q-=0.15; out=cv.toDataURL('image/jpeg',q); }
          if(out.length*0.75>MAX){
            alert('That image is too large even after resizing.');
            file.value=''; name.value=''; return;
          }
          data.value=out;
        };
        img.src=reader.result;
      };
      reader.readAsDataURL(f);
    });
  });
})();
`;

export function patientDetailPage(opts: {
  doctor: Doctor;
  patient: { id: string; name: string | null; phone: string; language: string };
  appointments: VisitRow[];
  totalVisits: number;
  accepted: readonly string[];
  /** Real ceiling from the active storage driver — the hint must not overstate it. */
  maxBytes: number;
  queueCount: number;
  csrfToken: string;
  flash?: string;
  error?: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const done = opts.appointments.filter((a) => a.status === 'DONE').length;
  const noShow = opts.appointments.filter((a) => a.status === 'NO_SHOW').length;
  const thisYear = DateTime.now().setZone(opts.doctor.timezone).year;
  const accept = opts.accepted.join(',');
  // Built from the driver's actual cap rather than stated in the string: a hint
  // promising more than the server accepts sends the doctor off to pick a file
  // that is then rejected.
  const hint = (
    opts.accepted.includes('application/pdf') ? s.uploadHintAll : s.uploadHintImages
  ).replace('{size}', fileSize(opts.maxBytes));
  const hidden = opts.totalVisits - opts.appointments.length;

  return page(
    {
      title: personName(opts.patient.name),
      csrfToken: opts.csrfToken,
      bare: true,
    },
    html`
      ${doctorHeader(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
      <main>
        ${opts.flash ? html`<div class="ok">${opts.flash}</div>` : ''}
        ${opts.error ? html`<div class="err">${opts.error}</div>` : ''}
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

        <h3 class="secl">${s.visitHistory}</h3>
        <div class="card flush">
          ${opts.appointments.length === 0
            ? html`<div class="tlmore">${s.noVisitsYet}</div>`
            : html`
                <div class="tl ${opts.appointments.length === 1 ? 'single' : ''}">
                  ${opts.appointments.map((a) => {
                    const bad = a.status === 'NO_SHOW' || a.status === 'CANCELLED';
                    // arrivedAt → startedAt is the wait the patient actually had;
                    // both are already fetched and were previously thrown away.
                    const waited =
                      a.arrivedAt && a.startedAt
                        ? formatWait((a.startedAt.getTime() - a.arrivedAt.getTime()) / 60000)
                        : null;
                    return html`
                      <div class="visit ${a.status === 'DONE' ? 'v-ok' : bad ? 'v-bad' : ''}">
                        <div class="vhead">
                          <span class="vdate">${visitDate(a.date, thisYear)}</span>
                          ${statusPill(a.status)}
                        </div>
                        <div class="vmeta">
                          ${a.tokenNumber !== null ? html`<span>#${a.tokenNumber}</span>` : ''}
                          ${a.slotStart
                            ? html`<span>${timeOnly(a.slotStart, opts.doctor.timezone)}</span>`
                            : ''}
                          ${waited ? html`<span>${s.waited} ${waited}</span>` : ''}
                          ${a.consultMins !== null ? html`<span>${a.consultMins} min</span>` : ''}
                        </div>
                        ${/* .notetext is white-space:pre-wrap, so the template's
                              own indentation would render as a leading indent —
                              keep the content flush. */ ''}
                        ${a.notes
                          ? html`<p class="notetext"><strong>${s.remarkLabel}:</strong> ${a.notes}</p>`
                          : ''}
                        ${a.followUpOn
                          ? html`<div class="vmeta">
                              <span class="pill ${a.followUpSentAt ? 'done' : 'arrived'}"
                                >${s.followUpDueOn(formatDateForPatient(a.followUpOn))}</span
                              >
                              ${a.followUpSentAt ? '' : html`<span>${s.followUpPending}</span>`}
                            </div>`
                          : ''}
                        ${documentsBlock({
                          visit: a,
                          s,
                          csrfToken: opts.csrfToken,
                          accept,
                          hint,
                        })}
                      </div>
                    `;
                  })}
                </div>
                ${hidden > 0
                  ? html`<div class="tlmore">+ ${hidden} ${s.moreVisits}</div>`
                  : ''}
              `}
        </div>

        <a href="/app/patients"
          ><button class="secondary" type="button">${s.backToPatients}</button></a
        >
      </main>
      ${doctorBottomNav(navFor(opts.doctor, 'patients', opts.queueCount, opts.csrfToken))}
    `,
    html`<script>
      ${raw(docScript(opts.maxBytes, fileSize(opts.maxBytes)))}
    </script>`,
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
