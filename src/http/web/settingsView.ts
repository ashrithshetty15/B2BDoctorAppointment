import type { Doctor } from '@prisma/client';
import { c } from '../../i18n/console';
import { html, page } from './layout';
import { doctorBottomNav, doctorHeader } from './nav';
import { bookingLink, qrSvg } from './qr';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<(typeof DAYS)[number], string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function windowsFor(workingHours: unknown, day: string): string {
  if (!workingHours || typeof workingHours !== 'object') return '';
  const value = (workingHours as Record<string, unknown>)[day];
  if (!Array.isArray(value)) return '';
  return value
    .filter((w): w is { start: string; end: string } => !!w && typeof w === 'object')
    .map((w) => `${String(w.start)}–${String(w.end)}`)
    .join(', ');
}

/**
 * Read-only for now: every field here is owned by the operator console, and a
 * doctor editing their own token cap mid-clinic would change ETAs under
 * patients who already have a token. Surfacing the values still matters — the
 * doctor needs to know what the bot is telling their patients.
 */
export function settingsPage(opts: {
  doctor: Doctor;
  queueCount: number;
  csrfToken: string;
}): string {
  const { doctor } = opts;
  const s = c(doctor.defaultLanguage);
  const navOpts = {
    clinicName: doctor.clinicName,
    doctorName: doctor.name,
    // Settings sits outside the four tabs, so nothing is marked current.
    current: 'queue' as const,
    queueCount: opts.queueCount,
    csrfToken: opts.csrfToken,
    s,
  };
  const link = doctor.whatsappNumber ? bookingLink(doctor.whatsappNumber) : null;

  return page(
    { title: s.settings, csrfToken: opts.csrfToken },
    html`
      ${doctorHeader(navOpts)}
      <main>
        <div class="card">
          <h2>${s.clinicDetails}</h2>
          <table>
            <tbody>
              <tr><th>${s.clinicDetails}</th><td>${doctor.clinicName}</td></tr>
              <tr><th>Doctor</th><td>Dr. ${doctor.name}</td></tr>
              <tr><th>Phone</th><td class="num">${doctor.phone}</td></tr>
              <tr><th>${s.timezoneLabel}</th><td>${doctor.timezone}</td></tr>
              <tr>
                <th>${s.languageLabel}</th>
                <td>${doctor.defaultLanguage === 'KN' ? 'ಕನ್ನಡ' : 'English'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>${s.bookingConfig}</h2>
          <table>
            <tbody>
              <tr><th>Mode</th><td>${doctor.bookingMode}</td></tr>
              <tr><th>${s.dailyCap}</th><td class="num">${doctor.dailyTokenCap}</td></tr>
              <tr><th>${s.consultLength}</th><td class="num">${doctor.consultDurationMins} min</td></tr>
              <tr>
                <th>${s.learnedAverage}</th>
                <td class="num">
                  ${doctor.avgConsultTimeMins.toFixed(1)} min
                  <div class="hint">
                    from ${doctor.consultSampleCount}
                    consult${doctor.consultSampleCount === 1 ? '' : 's'} — this drives the wait
                    times patients are told
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="hint">${s.changesViaAdmin}</p>
        </div>

        <div class="card">
          <h2>${s.workingHours}</h2>
          <table>
            <tbody>
              ${DAYS.map((day) => {
                const windows = windowsFor(doctor.workingHours, day);
                return html`<tr>
                  <th>${DAY_LABELS[day]}</th>
                  <td class="num">
                    ${windows ? windows : html`<span class="muted">${s.closedDay}</span>`}
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>

        ${link
          ? html`
              <div class="card">
                <h2>${s.scanToBook}</h2>
                <p class="sub">${s.noBookingsBody}</p>
                <div style="text-align:center">
                  <div class="qr">${qrSvg(link, { title: s.scanToBook })}</div>
                  <div>
                    <a class="walink" href="${link}" target="_blank" rel="noopener"
                      >+${doctor.whatsappNumber}</a
                    >
                  </div>
                </div>
              </div>
            `
          : ''}
      </main>
      ${doctorBottomNav(navOpts)}
    `,
  );
}
