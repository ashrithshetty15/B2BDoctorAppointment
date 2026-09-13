import type { Doctor } from '@prisma/client';
import { type RawHtml, html, page } from './layout';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

const DAY_LABELS: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export interface DoctorFormValues {
  name: string;
  clinicName: string;
  phone: string;
  bookingMode: string;
  dailyTokenCap: string;
  consultDurationMins: string;
  defaultLanguage: string;
  timezone: string;
  whatsappPhoneNumberId: string;
  missedCallNumber: string;
  hours: Record<Day, string>;
}

export function emptyHours(): Record<Day, string> {
  return { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' };
}

export function loginPage(opts: { error?: string; next?: string }): string {
  return page(
    { title: 'Sign in' },
    html`
      <div class="login">
        <div class="card">
          <h2>Clinic Console</h2>
          <p class="sub">Sign in with your access key</p>
          ${opts.error ? html`<div class="err">${opts.error}</div>` : ''}
          <form method="post" action="/app/login">
            ${opts.next ? html`<input type="hidden" name="next" value="${opts.next}" />` : ''}
            <label for="key">Access key</label>
            <input id="key" name="key" type="password" autocomplete="current-password" autofocus />
            <p class="hint">Doctors: your key begins with <code>dk_</code>.</p>
            <button type="submit">Sign in</button>
          </form>
        </div>
      </div>
    `,
  );
}

export function doctorsPage(opts: {
  doctors: Doctor[];
  csrfToken: string;
  flash?: string;
}): string {
  return page(
    { title: 'Doctors', csrfToken: opts.csrfToken, nav: true },
    html`
      <div class="card">
        <h2>Doctors</h2>
        <p class="sub">${opts.doctors.length} clinic${opts.doctors.length === 1 ? '' : 's'}</p>
        ${opts.flash ? html`<div class="ok">${opts.flash}</div>` : ''}
        ${opts.doctors.length === 0
          ? html`<p class="muted">No doctors yet.</p>`
          : html`
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Clinic</th>
                    <th>Mode</th>
                    <th>Cap</th>
                    <th>Consult</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${opts.doctors.map(
                    (d) => html`
                      <tr>
                        <td><a href="/app/doctors/${d.id}">${d.name}</a></td>
                        <td>${d.clinicName}</td>
                        <td>${d.bookingMode}</td>
                        <td>${d.dailyTokenCap}</td>
                        <td>${d.consultDurationMins} min</td>
                        <td>
                          <span class="pill ${d.status === 'ACTIVE' ? 'active' : 'disabled'}"
                            >${d.status}</span
                          >
                        </td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `}
        <a href="/app/doctors/new"><button type="button">Add doctor</button></a>
      </div>
    `,
  );
}

export function doctorDetailPage(opts: {
  doctor: Doctor;
  hours: Record<Day, string>;
  bookedToday: number;
  csrfToken: string;
  flash?: string;
  newApiKey?: string;
}): string {
  const d = opts.doctor;
  return page(
    { title: d.name, csrfToken: opts.csrfToken, nav: true },
    html`
      <div class="card">
        <h2>${d.name}</h2>
        <p class="sub">
          ${d.clinicName} ·
          <span class="pill ${d.status === 'ACTIVE' ? 'active' : 'disabled'}">${d.status}</span>
        </p>
        ${opts.flash ? html`<div class="ok">${opts.flash}</div>` : ''}
        ${opts.newApiKey
          ? html`<div class="ok">
              New API key — copy it now, it will not be shown again:<br /><code
                >${opts.newApiKey}</code
              >
            </div>`
          : ''}

        <table>
          <tbody>
            <tr><th>Booking mode</th><td>${d.bookingMode} <span class="hint">(set once at onboarding)</span></td></tr>
            <tr><th>Daily token cap</th><td>${d.dailyTokenCap}</td></tr>
            <tr><th>Consult duration</th><td>${d.consultDurationMins} min</td></tr>
            <tr>
              <th>Learned average</th>
              <td>
                ${d.avgConsultTimeMins.toFixed(1)} min
                <span class="hint">from ${d.consultSampleCount} consult${d.consultSampleCount === 1 ? '' : 's'} — this drives patient ETAs</span>
              </td>
            </tr>
            <tr><th>Booked today</th><td>${opts.bookedToday}</td></tr>
            <tr><th>Language</th><td>${d.defaultLanguage}</td></tr>
            <tr><th>Timezone</th><td>${d.timezone}</td></tr>
            <tr><th>Doctor phone</th><td>${d.phone}</td></tr>
            <tr><th>WhatsApp number id</th><td>${d.whatsappPhoneNumberId ?? html`<span class="muted">not set</span>`}</td></tr>
            <tr><th>Missed-call number</th><td>${d.missedCallNumber ?? html`<span class="muted">not set</span>`}</td></tr>
            <tr>
              <th>Working hours</th>
              <td>
                ${DAYS.map((day) =>
                  opts.hours[day]
                    ? html`<div>${DAY_LABELS[day]}: ${opts.hours[day]}</div>`
                    : html`<div class="muted">${DAY_LABELS[day]}: closed</div>`,
                )}
              </td>
            </tr>
            <tr><th>Leave dates</th><td>${d.leaveDates.length === 0 ? html`<span class="muted">none</span>` : d.leaveDates.map((x) => x.toISOString().slice(0, 10)).join(', ')}</td></tr>
          </tbody>
        </table>

        <div class="actions">
          <a href="/app/doctors/${d.id}/edit"><button type="button">Edit</button></a>
          <form method="post" action="/app/doctors/${d.id}/toggle-status">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            <button class="secondary" type="submit">
              ${d.status === 'ACTIVE' ? 'Disable' : 'Enable'}
            </button>
          </form>
          <form method="post" action="/app/doctors/${d.id}/rotate-key">
            <input type="hidden" name="_csrf" value="${opts.csrfToken}" />
            <button class="danger" type="submit">Rotate API key</button>
          </form>
        </div>
      </div>
    `,
  );
}

export function doctorFormPage(opts: {
  mode: 'create' | 'edit';
  values: DoctorFormValues;
  csrfToken: string;
  error?: string;
  doctorId?: string;
}): string {
  const editing = opts.mode === 'edit';
  const action = editing ? `/app/doctors/${opts.doctorId}/edit` : '/app/doctors/new';

  return page(
    { title: editing ? 'Edit doctor' : 'Add doctor', csrfToken: opts.csrfToken, nav: true },
    html`
      <div class="card">
        <h2>${editing ? 'Edit doctor' : 'Add doctor'}</h2>
        <p class="sub">
          ${editing
            ? html`Booking mode cannot be changed here — it is fixed at onboarding.`
            : html`Booking mode is permanent once set.`}
        </p>
        ${opts.error ? html`<div class="err">${opts.error}</div>` : ''}

        <form method="post" action="${action}">
          <input type="hidden" name="_csrf" value="${opts.csrfToken}" />

          <div class="row">
            <div>
              <label for="name">Doctor name</label>
              <input id="name" name="name" type="text" value="${opts.values.name}" />
            </div>
            <div>
              <label for="clinicName">Clinic name</label>
              <input
                id="clinicName"
                name="clinicName"
                type="text"
                value="${opts.values.clinicName}"
              />
            </div>
          </div>

          <div class="row">
            <div>
              <label for="phone">Doctor phone <span class="hint">not the WhatsApp sender</span></label>
              <input id="phone" name="phone" type="text" value="${opts.values.phone}" />
            </div>
            <div>
              <label for="bookingMode">Booking mode</label>
              ${editing
                ? html`<input type="text" value="${opts.values.bookingMode}" disabled />`
                : html`<select id="bookingMode" name="bookingMode">
                    ${['TOKEN', 'SLOT', 'HYBRID'].map(
                      (m) =>
                        html`<option value="${m}" ${opts.values.bookingMode === m ? 'selected' : ''}>
                          ${m}
                        </option>`,
                    )}
                  </select>`}
            </div>
          </div>

          <div class="row">
            <div>
              <label for="dailyTokenCap">Daily token cap</label>
              <input
                id="dailyTokenCap"
                name="dailyTokenCap"
                type="number"
                min="1"
                max="500"
                value="${opts.values.dailyTokenCap}"
              />
            </div>
            <div>
              <label for="consultDurationMins">Consult duration (min)</label>
              <input
                id="consultDurationMins"
                name="consultDurationMins"
                type="number"
                min="1"
                max="180"
                value="${opts.values.consultDurationMins}"
              />
            </div>
            <div>
              <label for="defaultLanguage">Default language</label>
              <select id="defaultLanguage" name="defaultLanguage">
                ${['EN', 'KN'].map(
                  (l) =>
                    html`<option value="${l}" ${opts.values.defaultLanguage === l ? 'selected' : ''}>
                      ${l === 'EN' ? 'English' : 'ಕನ್ನಡ'}
                    </option>`,
                )}
              </select>
            </div>
          </div>

          <div class="row">
            <div>
              <label for="timezone">Timezone</label>
              <input id="timezone" name="timezone" type="text" value="${opts.values.timezone}" />
            </div>
            <div>
              <label for="whatsappPhoneNumberId">WhatsApp phone number id</label>
              <input
                id="whatsappPhoneNumberId"
                name="whatsappPhoneNumberId"
                type="text"
                value="${opts.values.whatsappPhoneNumberId}"
              />
            </div>
            <div>
              <label for="missedCallNumber">Missed-call number</label>
              <input
                id="missedCallNumber"
                name="missedCallNumber"
                type="text"
                value="${opts.values.missedCallNumber}"
              />
            </div>
          </div>

          <label>Working hours <span class="hint">e.g. 09:30-13:00, 17:00-20:00 — leave blank for a closed day</span></label>
          ${DAYS.map(
            (day) => html`
              <label for="hours_${day}" class="hint">${DAY_LABELS[day]}</label>
              <input
                id="hours_${day}"
                name="hours_${day}"
                type="text"
                value="${opts.values.hours[day]}"
                placeholder="closed"
              />
            `,
          )}

          <button type="submit">${editing ? 'Save changes' : 'Create doctor'}</button>
          <a href="${editing ? `/app/doctors/${opts.doctorId}` : '/app/doctors'}"
            ><button class="secondary" type="button">Cancel</button></a
          >
        </form>
      </div>
    `,
  );
}

export function errorPage(opts: { title: string; message: string; backHref?: string }): string {
  const back = opts.backHref ?? '/app/doctors';
  return page(
    { title: opts.title },
    html`
      <div class="card">
        <h2>${opts.title}</h2>
        <p class="sub">${opts.message}</p>
        <a href="${back}">Go back</a>
      </div>
    `,
  );
}

export type { RawHtml };
