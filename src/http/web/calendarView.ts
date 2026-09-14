import type { Doctor } from '@prisma/client';
import type { CalendarSlot } from '../../domain/slots';
import { c } from '../../i18n/console';
import { html, page } from './layout';
import { doctorBottomNav, doctorHeader } from './nav';

function timeOnly(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

function personName(name: string | null): string {
  return name && name.trim() ? name : 'Unnamed';
}

/**
 * A day's appointment schedule: every slot the working hours produce, marked
 * free, booked or past.
 *
 * Shows the whole day rather than only free slots, because the doctor needs the
 * shape of their day — a gap at 11:00 reads very differently from a full
 * morning. getAvailableSlots is the patient-facing filter and deliberately
 * hides both, so this uses getDaySchedule instead.
 */
export function calendarPage(opts: {
  doctor: Doctor;
  slots: CalendarSlot[];
  date: string;
  prevDate: string;
  nextDate: string;
  dateLabel: string;
  isToday: boolean;
  onLeave: boolean;
  queueCount: number;
  csrfToken: string;
  flash?: string;
  error?: string;
}): string {
  const { doctor, slots } = opts;
  const s = c(doctor.defaultLanguage);
  const navOpts = {
    clinicName: doctor.clinicName,
    doctorName: doctor.name,
    current: 'calendar' as const,
    queueCount: opts.queueCount,
    csrfToken: opts.csrfToken,
    s,
    photo: doctor.photo,
    specialty: doctor.specialty,
    bookingMode: doctor.bookingMode,
  };

  const booked = slots.filter((x) => x.appointment).length;
  const free = slots.filter((x) => !x.appointment && !x.isPast).length;

  return page(
    { title: s.calendar, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(navOpts)}
      <main>
        ${opts.flash ? html`<div class="ok">${opts.flash}</div>` : ''}
        ${opts.error ? html`<div class="err">${opts.error}</div>` : ''}

        <div class="datenav">
          <a href="/app/calendar?date=${opts.prevDate}"
            ><button class="secondary" type="button" style="margin:0">←</button></a
          >
          <span class="today">${opts.dateLabel}</span>
          <a href="/app/calendar?date=${opts.nextDate}"
            ><button class="secondary" type="button" style="margin:0">→</button></a
          >
          ${opts.isToday ? '' : html`<a href="/app/calendar">${s.backToToday}</a>`}
        </div>

        <div class="stats">
          <div class="s"><div class="n">${booked}</div><div class="l">${s.bookedCount}</div></div>
          <div class="s"><div class="n">${free}</div><div class="l">${s.freeCount}</div></div>
        </div>

        ${opts.onLeave ? html`<div class="caveat">${s.onLeaveShort}</div>` : ''}
        ${slots.length === 0
          ? html`<div class="card">
              <div class="empty">
                <h3>${s.noSlotsTitle}</h3>
                <p>${s.noSlotsBody}</p>
              </div>
            </div>`
          : html`
              <div class="card flush">
                ${slots.map((slot) => {
                  const label = `${timeOnly(slot.start, doctor.timezone)}`;
                  if (slot.appointment) {
                    const a = slot.appointment;
                    return html`<div class="slotrow taken">
                      <div class="slottime">${label}</div>
                      <div class="body">
                        <div class="nm">
                          <a href="/app/patients/${a.patient.id}">${personName(a.patient.name)}</a>
                        </div>
                        <div class="sub">
                          <span class="pill ${a.status.toLowerCase()}"
                            >${a.status.replace('_', ' ')}</span
                          >
                          <span>${a.patient.phone}</span>
                        </div>
                      </div>
                    </div>`;
                  }
                  if (slot.isPast) {
                    return html`<div class="slotrow past">
                      <div class="slottime">${label}</div>
                      <div class="body muted">${s.slotPast}</div>
                    </div>`;
                  }
                  return html`<div class="slotrow">
                    <div class="slottime">${label}</div>
                    <div class="body muted">${s.slotFree}</div>
                    <div class="acts">
                      <a
                        href="/app/calendar/book?date=${opts.date}&slot=${encodeURIComponent(
                          slot.start.toISOString(),
                        )}"
                        ><button class="secondary" type="button">${s.bookThisSlot}</button></a
                      >
                    </div>
                  </div>`;
                })}
              </div>
            `}
      </main>
      ${doctorBottomNav(navOpts)}
    `,
  );
}

/** Who is taking a given slot — name, number, language. */
export function slotBookPage(opts: {
  doctor: Doctor;
  date: string;
  slotIso: string;
  slotLabel: string;
  dateLabel: string;
  queueCount: number;
  csrfToken: string;
  values?: { name?: string; phone?: string; language?: string };
  error?: string;
}): string {
  const s = c(opts.doctor.defaultLanguage);
  const v = opts.values ?? {};
  const navOpts = {
    clinicName: opts.doctor.clinicName,
    doctorName: opts.doctor.name,
    current: 'calendar' as const,
    queueCount: opts.queueCount,
    csrfToken: opts.csrfToken,
    s,
    photo: opts.doctor.photo,
    specialty: opts.doctor.specialty,
    bookingMode: opts.doctor.bookingMode,
  };

  return page(
    { title: s.bookThisSlot, csrfToken: opts.csrfToken, bare: true },
    html`
      ${doctorHeader(navOpts)}
      <main>
        <div class="card">
          <h2>${opts.slotLabel}</h2>
          <p class="sub">${opts.dateLabel}</p>
          ${opts.error ? html`<div class="err">${opts.error}</div>` : ''}

          <form method="post" action="/app/calendar/book">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            <input type="hidden" name="date" value="${opts.date}" />
            <input type="hidden" name="slot" value="${opts.slotIso}" />

            <label for="sname">${s.patientNameLabel}</label>
            <input id="sname" name="name" type="text" value="${v.name ?? ''}" autofocus required />

            <label for="sphone">${s.patientPhoneLabel}</label>
            <input
              id="sphone"
              name="phone"
              type="text"
              inputmode="numeric"
              value="${v.phone ?? ''}"
              placeholder="919876543210"
              required
            />
            <p class="hint">${s.phoneHint}</p>

            <label for="slang">${s.languageForPatient}</label>
            <select id="slang" name="language">
              ${['EN', 'KN'].map(
                (l) =>
                  html`<option value="${l}" ${(v.language ?? opts.doctor.defaultLanguage) === l ? 'selected' : ''}>
                    ${l === 'KN' ? 'ಕನ್ನಡ' : 'English'}
                  </option>`,
              )}
            </select>

            <div class="actions" style="margin-top:18px">
              <button type="submit">${s.confirmBooking}</button>
              <a href="/app/calendar?date=${opts.date}"
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
