import type { ConsoleStrings } from '../../i18n/console';
import { type RawHtml, html, raw } from './layout';

/**
 * Navigation shared by all four doctor screens.
 *
 * Two presentations of the same links, chosen by CSS rather than by rendering
 * twice conditionally on a guessed user agent: a tab bar under the header on
 * tablet and desktop, and a fixed bottom bar on phones, where the top of a
 * held device is the hardest place to reach.
 */

export type DoctorTab = 'queue' | 'calendar' | 'bookings' | 'patients' | 'reports';

export interface DoctorNavOptions {
  clinicName: string;
  doctorName: string;
  current: DoctorTab;
  /** Waiting patients — shown as a live badge so the nav carries information. */
  queueCount: number;
  csrfToken: string;
  s: ConsoleStrings;
  /** Decides whether Queue, Calendar or both appear. */
  bookingMode: 'TOKEN' | 'SLOT' | 'HYBRID';
  /** Data URI avatar; initials are the fallback. */
  photo?: string | null;
  /** Shown under the clinic name when set. */
  specialty?: string | null;
}

const ICONS: Record<DoctorTab, RawHtml> = {
  queue: raw(
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h2v2H4zM8 6h12v2H8zM4 11h2v2H4zM8 11h12v2H8zM4 16h2v2H4zM8 16h12v2H8z"/></svg>',
  ),
  calendar: raw(
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-13h-2v6l5 3 1-1.7-4-2.3z"/></svg>',
  ),
  bookings: raw(
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM5 9v10h14V9zm2 2h4v4H7z"/></svg>',
  ),
  patients: raw(
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z"/></svg>',
  ),
  reports: raw(
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h4v8H4zM10 3h4v18h-4zM16 9h4v12h-4z"/></svg>',
  ),
};

const HREF: Record<DoctorTab, string> = {
  queue: '/app/queue',
  calendar: '/app/calendar',
  bookings: '/app/bookings',
  patients: '/app/patients',
  reports: '/app/reports',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function labelFor(tab: DoctorTab, s: ConsoleStrings): string {
  return {
    queue: s.queue,
    calendar: s.calendar,
    bookings: s.bookings,
    patients: s.patients,
    reports: s.reports,
  }[tab];
}

/**
 * A TOKEN clinic has no appointment times and a SLOT clinic has no token queue,
 * so showing both to either is an invitation to a dead screen. HYBRID genuinely
 * runs both.
 */
function tabsFor(mode: 'TOKEN' | 'SLOT' | 'HYBRID'): DoctorTab[] {
  const rest: DoctorTab[] = ['bookings', 'patients', 'reports'];
  if (mode === 'SLOT') return ['calendar', ...rest];
  if (mode === 'HYBRID') return ['queue', 'calendar', ...rest];
  return ['queue', ...rest];
}

/**
 * Header: clinic identity on the left, avatar on the right. The avatar is the
 * menu trigger and holds only account-level actions — navigation lives in the
 * tab bars, not hidden behind a menu.
 */
export function doctorHeader(opts: DoctorNavOptions): RawHtml {
  const { clinicName, doctorName, csrfToken, s } = opts;

  return html`
    <header class="top">
      <div class="ident">
        <div class="who">
          <div class="clinic">${clinicName}</div>
          <div class="doc">
            Dr. ${doctorName}${opts.specialty ? html` · ${opts.specialty}` : ''}
          </div>
        </div>
      </div>

      <details class="menu">
        <summary class="avatar-btn" aria-label="${s.account}" role="button">
          <span class="avatar" aria-hidden="true">
            ${opts.photo ? html`<img src="${opts.photo}" alt="" />` : initials(doctorName)}
          </span>
        </summary>
        <div class="sheet">
          <a href="/app/settings">${s.settings}</a>
          <form method="post" action="/app/doctor-logout">
            <input type="hidden" name="_csrf" value="${csrfToken}" />
            <button type="submit">${s.signOut}</button>
          </form>
        </div>
      </details>
    </header>

    <nav class="tabs" aria-label="${s.sections}">
      ${tabsFor(opts.bookingMode).map((tab) => {
        const active = tab === opts.current;
        return html`<a
          href="${HREF[tab]}"
          class="tab ${active ? 'on' : ''}"
          ${active ? raw('aria-current="page"') : ''}
        >
          ${labelFor(tab, s)}${tab === 'queue' && opts.queueCount > 0
            ? html` <span class="badge">${opts.queueCount}</span>`
            : ''}
        </a>`;
      })}
    </nav>
  `;
}

/**
 * Phone navigation. Rendered on every page but revealed only under the mobile
 * breakpoint; `main` gains bottom padding there so nothing hides beneath it.
 */
export function doctorBottomNav(opts: DoctorNavOptions): RawHtml {
  const { s } = opts;
  return html`
    <nav class="btabs" aria-label="${s.sections}">
      ${tabsFor(opts.bookingMode).map((tab) => {
        const active = tab === opts.current;
        return html`<a
          href="${HREF[tab]}"
          class="btab ${active ? 'on' : ''}"
          ${active ? raw('aria-current="page"') : ''}
        >
          <span class="ico"
            >${ICONS[tab]}${tab === 'queue' && opts.queueCount > 0
              ? html`<span class="dotbadge">${opts.queueCount}</span>`
              : ''}</span
          >
          <span class="lbl">${labelFor(tab, s)}</span>
        </a>`;
      })}
    </nav>
  `;
}
