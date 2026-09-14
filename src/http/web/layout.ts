/**
 * Minimal server-side rendering: tagged template literals, no view engine.
 *
 * A templating dependency would buy autoescaping and little else here — the
 * console is a handful of pages. `html` gives the same guarantee: every
 * interpolated value is escaped unless explicitly wrapped in raw(), so the
 * unsafe path is the one you have to type out.
 */

export interface RawHtml {
  readonly __html: string;
}

export function raw(value: string): RawHtml {
  return { __html: value };
}

function isRaw(value: unknown): value is RawHtml {
  return typeof value === 'object' && value !== null && '__html' in value;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Interpolated = string | number | boolean | null | undefined | RawHtml | Interpolated[];

function render(value: Interpolated): string {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (isRaw(value)) return value.__html;
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Interpolated[]): RawHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + (strings[i + 1] ?? '');
  }
  return raw(out);
}

/**
 * Design tokens.
 *
 * Every screen draws from this one set, so Bookings / Patients / Reports stay
 * consistent with the queue without redefining anything. The accent is reserved
 * for the single primary action on a screen — if two things are accent-coloured,
 * one of them is wrong.
 */
const STYLES = `
:root{
  /* Warm neutral ground, not blue-grey: reads calmer under clinic lighting. */
  --bg:#f7f5f1;
  --surface:#fff;
  --surface-2:#fbf9f6;

  --ink:#1f2421;
  --ink-2:#4a5450;
  --ink-3:#6f7a75;

  /* One confident accent, used for the primary action and nothing else. */
  --accent:#0f6e5c;
  --accent-ink:#fff;
  --accent-soft:#e6f2ef;

  --warn:#a35a06;
  --warn-soft:#fdf1e0;
  --danger:#a3231b;
  --danger-soft:#fceeed;
  --ok:#1c6b3f;
  --ok-soft:#e8f4ec;

  --line:#e7e1d8;
  --line-2:#d8d1c6;

  /* 4-point spacing scale. */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px;

  /* Type scale. Body is 16px; the hero token sits ~5.5x above it. */
  --t-xs:13px; --t-sm:14px; --t-md:16px; --t-lg:19px; --t-xl:24px;
  --t-2xl:30px; --t-hero:88px;

  --r-sm:10px; --r-md:14px; --r-lg:20px; --r-pill:999px;

  --shadow-1:0 1px 2px rgba(31,36,33,.04), 0 2px 8px rgba(31,36,33,.05);
  --shadow-2:0 2px 4px rgba(31,36,33,.05), 0 8px 24px rgba(31,36,33,.07);

  --tap:44px;
}

*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;
  font:var(--t-md)/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Kannada",sans-serif;
  background:var(--bg);color:var(--ink);
  -webkit-font-smoothing:antialiased;
}
a{color:var(--accent);text-underline-offset:2px}

/* Visible focus for keyboard users on every interactive element. */
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:var(--r-sm)}

/* ---- header / clinic identity ---- */
header.top{
  background:var(--surface);border-bottom:1px solid var(--line);
  padding:var(--s3) var(--s4);display:flex;align-items:center;gap:var(--s3);
}
header.top h1{font-size:var(--t-md);margin:0;font-weight:600;letter-spacing:-.01em}
header.top nav{margin-left:auto;display:flex;gap:var(--s4);align-items:center}

.ident{display:flex;align-items:center;gap:var(--s3);min-width:0}
.avatar{
  width:40px;height:40px;flex:0 0 40px;border-radius:var(--r-pill);
  background:var(--accent-soft);color:var(--accent);
  display:grid;place-items:center;font-weight:650;font-size:var(--t-sm);letter-spacing:.02em;
}
.ident .who{min-width:0}
.ident .clinic{font-weight:650;font-size:var(--t-md);line-height:1.25;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ident .doc{font-size:var(--t-sm);color:var(--ink-3);line-height:1.25;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---- tab bar (tablet / desktop) ---- */
nav.tabs{
  background:var(--surface);border-bottom:1px solid var(--line);
  display:flex;gap:var(--s1);padding:0 var(--s4);
  overflow-x:auto;scrollbar-width:none;
}
nav.tabs::-webkit-scrollbar{display:none}
nav.tabs .tab{
  position:relative;display:inline-flex;align-items:center;gap:var(--s2);
  padding:var(--s3) var(--s4);min-height:var(--tap);white-space:nowrap;
  color:var(--ink-2);text-decoration:none;font-weight:600;font-size:var(--t-sm);
  border-bottom:2px solid transparent;margin-bottom:-1px;
}
nav.tabs .tab:hover{color:var(--ink)}
nav.tabs .tab.on{color:var(--accent);border-bottom-color:var(--accent)}
nav.tabs .badge{
  background:var(--accent-soft);color:var(--accent);border-radius:var(--r-pill);
  padding:1px 8px;font-size:var(--t-xs);font-weight:700;font-variant-numeric:tabular-nums;
}
nav.tabs .tab.on .badge{background:var(--accent);color:var(--accent-ink)}

/* ---- bottom tab bar (phones) ---- */
nav.btabs{display:none}
@media (max-width:700px){
  nav.tabs{display:none}
  nav.btabs{
    display:flex;position:fixed;left:0;right:0;bottom:0;z-index:30;
    background:var(--surface);border-top:1px solid var(--line);
    padding-bottom:env(safe-area-inset-bottom,0);
    box-shadow:0 -2px 12px rgba(31,36,33,.06);
  }
  nav.btabs .btab{
    flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:2px;padding:var(--s2) var(--s1);min-height:56px;
    color:var(--ink-3);text-decoration:none;font-weight:600;
  }
  nav.btabs .btab.on{color:var(--accent)}
  nav.btabs .ico{position:relative;display:block;width:22px;height:22px}
  nav.btabs .ico svg{width:22px;height:22px;fill:currentColor;display:block}
  nav.btabs .lbl{font-size:11px;letter-spacing:.01em;line-height:1.1;text-align:center;
    overflow:hidden;text-overflow:ellipsis;max-width:100%}
  nav.btabs .dotbadge{
    position:absolute;top:-5px;right:-9px;background:var(--accent);color:var(--accent-ink);
    border-radius:var(--r-pill);font-size:10px;font-weight:700;line-height:1;
    padding:2px 5px;min-width:16px;text-align:center;font-variant-numeric:tabular-nums;
  }
  /* Clear the fixed bar so the last row is never trapped underneath it. */
  main{padding-bottom:calc(72px + env(safe-area-inset-bottom,0))}
}

/* Avatar menu; <details> keeps it dependency-free. */
.menu{position:relative;margin-left:auto;flex:0 0 auto}
.menu>summary{
  list-style:none;cursor:pointer;width:var(--tap);height:var(--tap);
  border-radius:var(--r-pill);display:grid;place-items:center;
  color:var(--ink-3);font-size:20px;line-height:1;
}
.menu>summary.avatar-btn{padding:0}
.menu>summary.avatar-btn:hover .avatar{filter:brightness(.96)}
.menu>summary::-webkit-details-marker{display:none}
.menu>summary:hover{background:var(--surface-2)}
.menu .sheet{
  position:absolute;right:0;top:calc(var(--tap) + var(--s1));z-index:20;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);
  box-shadow:var(--shadow-2);padding:var(--s2);min-width:200px;
}
.menu .sheet a,.menu .sheet button{
  display:block;width:100%;text-align:left;padding:var(--s3);border-radius:var(--r-sm);
  background:none;border:0;font:inherit;color:var(--ink);cursor:pointer;margin:0;
  min-height:var(--tap);
}
.menu .sheet a:hover,.menu .sheet button:hover{background:var(--surface-2)}

main{max-width:760px;margin:0 auto;padding:var(--s4) var(--s4) var(--s7)}
main.wide{max-width:1080px}

/* ---- cards ---- */
.card{
  background:var(--surface);border-radius:var(--r-lg);box-shadow:var(--shadow-1);
  padding:var(--s5);margin-bottom:var(--s4);
}
.card.flush{padding:0;overflow:hidden}
h2{font-size:var(--t-lg);margin:0 0 var(--s1);font-weight:650;letter-spacing:-.01em}
p.sub{color:var(--ink-3);margin:0 0 var(--s4);font-size:var(--t-sm)}

/* ---- hero: now serving ---- */
.hero{
  background:linear-gradient(180deg,var(--surface) 0%,var(--surface-2) 100%);
  border-radius:var(--r-lg);box-shadow:var(--shadow-2);
  padding:var(--s5);margin-bottom:var(--s4);
}
.hero .eyebrow{
  font-size:var(--t-xs);text-transform:uppercase;letter-spacing:.08em;
  color:var(--ink-3);font-weight:650;margin-bottom:var(--s2);
}
.hero .token{
  font-size:var(--t-hero);line-height:.92;font-weight:700;letter-spacing:-.04em;
  font-variant-numeric:tabular-nums;color:var(--ink);
}
.hero .token .hash{font-size:.42em;color:var(--ink-3);font-weight:650;vertical-align:.28em;margin-right:.06em}
.hero .who{font-size:var(--t-xl);font-weight:600;margin-top:var(--s2);
  overflow-wrap:anywhere}
.hero .meta{color:var(--ink-2);font-size:var(--t-md);margin-top:var(--s1)}
.hero.idle .token{color:var(--ink-3);font-size:var(--t-2xl);letter-spacing:-.01em;line-height:1.2}

/* ---- primary action ---- */
button,.btn{
  font:inherit;font-weight:600;cursor:pointer;border:0;border-radius:var(--r-md);
  background:var(--accent);color:var(--accent-ink);
  padding:var(--s3) var(--s5);min-height:var(--tap);
}
button:hover:not(:disabled),.btn:hover{filter:brightness(1.06)}
button:disabled{cursor:not-allowed}

.cta{
  display:flex;align-items:center;justify-content:space-between;gap:var(--s4);
  width:100%;padding:var(--s4) var(--s5);border-radius:var(--r-md);
  font-size:var(--t-lg);min-height:64px;text-align:left;
  box-shadow:0 2px 0 rgba(0,0,0,.06);
}
.cta .lead{font-weight:650;letter-spacing:-.01em}
.cta .next{font-size:var(--t-sm);font-weight:500;opacity:.92;margin-top:2px;
  overflow-wrap:anywhere}
.cta .chev{font-size:var(--t-xl);opacity:.85;flex:0 0 auto}
.cta:disabled{background:var(--surface-2);color:var(--ink-3);box-shadow:none;
  outline:1px solid var(--line)}

button.secondary{background:var(--surface);color:var(--ink);outline:1px solid var(--line-2)}
button.secondary:hover{background:var(--surface-2);filter:none}
button.danger{background:var(--danger)}
button.ghost{background:none;color:var(--ink-2);padding:var(--s2) var(--s3);min-height:36px;
  font-size:var(--t-sm);outline:1px solid var(--line)}
button.ghost:hover{background:var(--surface-2);filter:none}

/* ---- stats: compact, secondary to the hero, tone follows load ---- */
.stats{display:flex;gap:var(--s2);margin-bottom:var(--s4);flex-wrap:wrap}
.stats .s{
  flex:1 1 0;min-width:96px;background:var(--surface);border-radius:var(--r-md);
  padding:var(--s3) var(--s4);box-shadow:var(--shadow-1);
}
.stats .s .n{font-size:var(--t-xl);font-weight:650;line-height:1.15;font-variant-numeric:tabular-nums}
.stats .s .l{font-size:var(--t-xs);color:var(--ink-3);text-transform:uppercase;
  letter-spacing:.05em;font-weight:600;margin-top:2px;overflow-wrap:anywhere}
.stats .s.busy{background:var(--warn-soft)}
.stats .s.busy .n{color:var(--warn)}
.stats .s.busy .l{color:var(--warn)}

/* ---- queue rows ---- */
.qrow{
  display:flex;align-items:center;gap:var(--s4);padding:var(--s4) var(--s5);
  border-top:1px solid var(--line);
  animation:rowin .28s ease both;
}
.qrow:first-child{border-top:0}
.qrow.overdue{background:var(--warn-soft)}
@keyframes rowin{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.qrow{animation:none}}

.qrow .tok{
  font-size:var(--t-xl);font-weight:700;font-variant-numeric:tabular-nums;
  min-width:52px;flex:0 0 auto;letter-spacing:-.02em;
}
.qrow.overdue .tok{color:var(--warn)}
.qrow .body{flex:1 1 auto;min-width:0}
.qrow .nm{font-weight:600;font-size:var(--t-md);overflow-wrap:anywhere}
.qrow .sub{font-size:var(--t-sm);color:var(--ink-3);margin-top:1px;
  display:flex;gap:var(--s2);flex-wrap:wrap;align-items:center}
.qrow .acts{display:flex;gap:var(--s2);flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end}
.qrow .acts form{display:inline}

.wa{display:inline-flex;align-items:center;gap:4px;color:var(--ok);font-weight:600}
.wa svg{width:13px;height:13px;fill:currentColor}
.waited.over{color:var(--warn);font-weight:650}

/* ---- pills ---- */
.pill{display:inline-block;padding:3px 10px;border-radius:var(--r-pill);
  font-size:var(--t-xs);font-weight:650;background:var(--surface-2);color:var(--ink-3);
  letter-spacing:.01em}
.pill.active,.pill.done{background:var(--ok-soft);color:var(--ok)}
.pill.disabled,.pill.no_show{background:var(--danger-soft);color:var(--danger)}
.pill.booked{background:var(--surface-2);color:var(--ink-2)}
.pill.arrived{background:var(--warn-soft);color:var(--warn)}
.pill.in_progress{background:var(--accent-soft);color:var(--accent)}
.pill.cancelled{background:var(--surface-2);color:var(--ink-3);text-decoration:line-through}

/* ---- live indicator ---- */
.live{display:inline-flex;align-items:center;gap:6px;font-size:var(--t-xs);color:var(--ink-3)}
.dot{width:7px;height:7px;border-radius:var(--r-pill);background:var(--ok);flex:0 0 auto}
.dot.beat{animation:beat 2.6s ease-in-out infinite}
@keyframes beat{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.dot.beat{animation:none;opacity:.8}}

/* ---- chips ---- */
.chips{display:flex;gap:var(--s2);flex-wrap:wrap;margin:var(--s3) 0}
.chip{
  border-radius:var(--r-pill);padding:var(--s2) var(--s4);min-height:var(--tap);
  background:var(--surface);color:var(--ink);outline:1px solid var(--line-2);
  font-weight:600;font-size:var(--t-md);
}
.chip:hover{background:var(--surface-2);filter:none}
.chip[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent);
  outline:2px solid var(--accent)}

/* ---- empty state ---- */
.empty{text-align:center;padding:var(--s6) var(--s4)}
.empty h3{font-size:var(--t-xl);margin:0 0 var(--s2);font-weight:650}
.empty p{color:var(--ink-2);margin:0 auto var(--s5);max-width:42ch}
.qr{background:#fff;padding:var(--s4);border-radius:var(--r-md);display:inline-block;
  box-shadow:var(--shadow-1)}
.qr svg{display:block;width:168px;height:168px;shape-rendering:crispEdges}
.walink{
  display:inline-flex;align-items:center;gap:var(--s2);margin-top:var(--s4);
  background:var(--ok-soft);color:var(--ok);font-weight:650;
  padding:var(--s3) var(--s4);border-radius:var(--r-pill);text-decoration:none;
  word-break:break-all;
}

/* ---- forms ---- */
label{display:block;margin:var(--s4) 0 var(--s1);font-weight:600;font-size:var(--t-sm)}
.hint{font-weight:400;color:var(--ink-3);font-size:var(--t-sm)}
input[type=text],input[type=number],input[type=password],select,textarea{
  width:100%;padding:var(--s3);border:1px solid var(--line-2);border-radius:var(--r-sm);
  font:inherit;background:var(--surface);color:inherit;min-height:var(--tap);
}
textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--t-sm)}

/* ---- messages ---- */
.err{background:var(--danger-soft);color:var(--danger);padding:var(--s3) var(--s4);
  border-radius:var(--r-sm);margin-bottom:var(--s4);font-size:var(--t-sm)}
.ok{background:var(--ok-soft);color:var(--ok);padding:var(--s3) var(--s4);
  border-radius:var(--r-sm);margin-bottom:var(--s4);font-size:var(--t-sm)}
.caveat{background:var(--warn-soft);color:var(--warn);padding:var(--s3) var(--s4);
  border-radius:var(--r-sm);font-size:var(--t-sm);margin:var(--s3) 0}
.muted{color:var(--ink-3)}

/* Preview of the exact WhatsApp text before it is sent. */
.preview{
  background:var(--surface-2);border-left:3px solid var(--ok);border-radius:var(--r-sm);
  padding:var(--s4);white-space:pre-wrap;font-size:var(--t-sm);color:var(--ink-2);
  overflow-wrap:anywhere;margin:var(--s3) 0;
}

/* ---- tables (bookings / patients / reports) ---- */
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:var(--s3) var(--s2);border-bottom:1px solid var(--line);
  vertical-align:middle}
th{font-size:var(--t-xs);text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);
  font-weight:650}
td.num{font-variant-numeric:tabular-nums}
.bar{height:8px;border-radius:var(--r-pill);background:var(--accent);min-width:2px}

.row{display:flex;gap:var(--s4);flex-wrap:wrap}
.row>div{flex:1 1 200px;min-width:0}
.actions{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap}
.actions form{display:inline}
.stat{display:flex;gap:var(--s5);flex-wrap:wrap;margin-bottom:var(--s1)}
.stat>div{flex:0 0 auto;min-width:110px}
.stat .n{font-size:var(--t-2xl);font-weight:650;line-height:1.2;font-variant-numeric:tabular-nums}
.stat .l{font-size:var(--t-xs);color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.datenav{display:flex;gap:var(--s3);align-items:center;margin-bottom:var(--s4);flex-wrap:wrap}
.datenav .today{font-weight:650}
.login{max-width:400px;margin:8vh auto}
code{background:var(--surface-2);padding:2px 6px;border-radius:6px;font-size:var(--t-sm);
  word-break:break-all}

/* ---- responsive ---- */
@media (max-width:600px){
  :root{--t-hero:72px}
  main{padding:var(--s3) var(--s3) var(--s7)}
  .card,.hero{padding:var(--s4);border-radius:var(--r-md)}
  .qrow{padding:var(--s3) var(--s4);gap:var(--s3);flex-wrap:wrap}
  .qrow .acts{width:100%;justify-content:flex-start;padding-left:calc(52px + var(--s3))}
  header.top{padding:var(--s3)}
}
@media (min-width:860px){
  /* Two columns on desktop so the queue is not a lonely narrow strip. */
  .split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);
    gap:var(--s4);align-items:start}
}
`;

export interface NavLink {
  href: string;
  label: string;
  /** Renders as the current page rather than a link. */
  current?: boolean;
}

export interface LayoutOptions {
  title: string;
  /** Omitted on the login page, which has no session and no nav. */
  csrfToken?: string;
  /**
   * Omit for pages with no session. `true` keeps the operator nav; pass an
   * object for any other audience — the doctor console has its own links and
   * its own logout route.
   */
  nav?: boolean | { brand: string; links: NavLink[]; logoutAction: string };
}

const ADMIN_NAV: { brand: string; links: NavLink[]; logoutAction: string } = {
  brand: 'Clinic Console',
  links: [{ href: '/app/doctors', label: 'Doctors' }],
  logoutAction: '/app/logout',
};

export function page(opts: LayoutOptions, body: RawHtml, extraHead?: RawHtml): string {
  const nav = opts.nav === true ? ADMIN_NAV : opts.nav === false ? undefined : opts.nav;

  const head = html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${opts.title} · ${nav?.brand ?? 'Clinic Console'}</title>
        ${opts.csrfToken ? html`<meta name="csrf-token" content="${opts.csrfToken}" />` : ''}
        <style>
          ${raw(STYLES)}
        </style>
        ${extraHead ?? ''}
      </head>
      <body>
        ${nav
          ? html`<header class="top">
              <h1>${nav.brand}</h1>
              <nav>
                ${nav.links.map((l) =>
                  l.current
                    ? html`<strong>${l.label}</strong>`
                    : html`<a href="${l.href}">${l.label}</a>`,
                )}
                <form method="post" action="${nav.logoutAction}">
                  <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ''}" />
                  <button class="secondary" style="margin:0;padding:6px 12px">Sign out</button>
                </form>
              </nav>
            </header>`
          : ''}
        <main>${body}</main>
      </body>
    </html>
  `;
  return head.__html;
}
