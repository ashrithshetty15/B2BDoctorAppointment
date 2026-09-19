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

/** First and last initial, for avatar fallbacks. Handles a blank name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
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
.avatar.lg{width:84px;height:84px;flex:0 0 84px;font-size:var(--t-xl)}
.avatar img{width:100%;height:100%;border-radius:var(--r-pill);object-fit:cover;display:block}
.photorow{display:flex;gap:var(--s4);align-items:flex-start;flex-wrap:wrap;margin-bottom:var(--s2)}
.photobox{flex:0 0 auto}
img.photo{width:84px;height:84px;border-radius:var(--r-pill);object-fit:cover;
  box-shadow:var(--shadow-1);display:block}
.checkline{display:flex;align-items:center;gap:var(--s2);font-weight:500;margin-top:var(--s2)}
.checkline input{width:auto;min-height:auto}
input[type=file]{width:100%;padding:var(--s2);border:1px dashed var(--line-2);
  border-radius:var(--r-sm);background:var(--surface-2);font:inherit;font-size:var(--t-sm);
  min-height:var(--tap)}
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
/* A circular chip, not a floating glyph. At low opacity on the accent a bare
   tick reads as a status badge — "already done" — rather than as the control
   that performs the action. The chip makes it unmistakably a target, and works
   for either glyph. */
.cta .chev{
  flex:0 0 auto;width:40px;height:40px;border-radius:var(--r-pill);
  background:rgba(255,255,255,.2);display:grid;place-items:center;
  font-size:var(--t-lg);line-height:1;
}
.cta:hover .chev{background:rgba(255,255,255,.3)}
.cta:active .chev{background:rgba(255,255,255,.36)}
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

/* Secondary, and set apart from the hero: booking a walk-in is frequent but is
   never the thing the doctor is mid-way through doing. */
.walkin-bar{display:flex;justify-content:flex-end;margin:0 0 var(--s3)}
.walkin-bar button{margin:0}

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

/* Patient detail header: avatar beside the name. */
.phead{display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap}
.phead h2{margin:0}

/* Read-only key/value pairs, replacing tables used purely for layout. */
dl.kv{display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:var(--s2) var(--s4);margin:0}
dl.kv dt{color:var(--ink-3);font-size:var(--t-sm);font-weight:600;
  padding:var(--s2) 0;border-top:1px solid var(--line)}
dl.kv dd{margin:0;padding:var(--s2) 0;border-top:1px solid var(--line);overflow-wrap:anywhere}
dl.kv dt:first-of-type,dl.kv dt:first-of-type+dd{border-top:0}
@media (max-width:480px){
  dl.kv{grid-template-columns:1fr;gap:0}
  dl.kv dd{border-top:0;padding-top:0;padding-bottom:var(--s3)}
}

/* ---- patient rows ---- */
/* Not scoped to <a>: the follow-up list needs a row with two destinations in it,
   which cannot itself be an anchor. Hover stays anchor-only so a non-clickable
   row does not pretend otherwise. */
.prow{display:flex;align-items:center;gap:var(--s4);padding:var(--s3) var(--s5);
  border-top:1px solid var(--line);text-decoration:none;color:inherit}
.prow:first-child{border-top:0}
a.prow:hover{background:var(--surface-2)}
.prow .body{flex:1 1 auto;min-width:0}
.prow .nm{display:block;font-weight:600;font-size:var(--t-md);overflow-wrap:anywhere}
.prow .sub{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap;
  font-size:var(--t-sm);color:var(--ink-3);margin-top:1px}
.prow .meta{flex:0 0 auto;text-align:right;line-height:1.25}
.prow .visits{display:block;font-size:var(--t-lg);font-weight:650;
  font-variant-numeric:tabular-nums}
.prow .meta .l{display:block;font-size:var(--t-xs);color:var(--ink-3);
  text-transform:uppercase;letter-spacing:.04em}
.prow .last{display:block;font-size:var(--t-xs);color:var(--ink-3);margin-top:2px;
  font-variant-numeric:tabular-nums}
@media (max-width:600px){.prow{padding:var(--s3) var(--s4);gap:var(--s3)}}

/* Remark on a row: quiet until it has content, never competing with the name. */
details.note{margin-top:var(--s2)}
details.note>summary{
  list-style:none;cursor:pointer;font-size:var(--t-xs);font-weight:650;
  color:var(--ink-3);display:inline-flex;align-items:center;gap:4px;
  padding:2px 0;min-height:24px;
}
details.note>summary::-webkit-details-marker{display:none}
details.note>summary::before{content:'\\270F\\FE0F';font-size:12px}
details.note>summary:hover{color:var(--accent)}
/* Not scoped to details.note: the patient timeline shows the same remark outside
   a disclosure, and it should look identical there. */
.notetext{
  margin:var(--s1) 0;padding:var(--s2) var(--s3);background:var(--warn-soft);
  border-radius:var(--r-sm);font-size:var(--t-sm);color:var(--ink-2);
  overflow-wrap:anywhere;white-space:pre-wrap;
}
details.note textarea{font-family:inherit;font-size:var(--t-sm);margin-top:var(--s1)}
details.note button{margin-top:var(--s2)}

/* ---- calendar slot rows ---- */
.slotrow{display:flex;align-items:center;gap:var(--s4);padding:var(--s3) var(--s5);
  border-top:1px solid var(--line)}
.slotrow:first-child{border-top:0}
.slotrow.taken{background:var(--accent-soft)}
.slotrow.past{opacity:.5}
.slottime{font-variant-numeric:tabular-nums;font-weight:700;font-size:var(--t-md);
  min-width:56px;flex:0 0 auto}
.slotrow .body{flex:1 1 auto;min-width:0}
.slotrow .acts{flex:0 0 auto}
.slotrow .acts button{margin:0;padding:var(--s2) var(--s4);min-height:38px;font-size:var(--t-sm)}
@media (max-width:600px){.slotrow{padding:var(--s3) var(--s4);gap:var(--s3)}}

/* ---- pick a few patients to cancel ---- */
.picklist{display:flex;flex-direction:column;gap:2px;margin:var(--s3) 0}
/* The whole row is the label, so the tap target is the row not the 16px box. */
label.pick{display:flex;align-items:center;gap:var(--s3);margin:0;
  padding:var(--s2) var(--s3);border-radius:var(--r-sm);background:var(--surface-2);
  font-weight:500;cursor:pointer;min-height:var(--tap)}
label.pick:hover{background:var(--accent-soft)}
label.pick input[type=checkbox]{width:20px;height:20px;flex:0 0 auto;margin:0;accent-color:var(--accent)}
label.pick .who{display:flex;align-items:baseline;gap:var(--s3);flex-wrap:wrap;min-width:0}
label.pick .nm{font-weight:650;overflow-wrap:anywhere}
label.pick .sub{font-variant-numeric:tabular-nums}

/* ---- time off / day closure ---- */
/* A form that sits inside a dl row without breaking the grid. */
form.inline{margin:0;display:inline-block}
button.sm{margin:0;width:auto;padding:var(--s1) var(--s3);min-height:34px;
  font-size:var(--t-xs)}
.clash{margin:var(--s2) 0;padding-left:var(--s5);font-weight:500}
.clash li{margin:2px 0}
/* The reachable / unreachable split on the close-day confirmation. */
.reach{display:flex;flex-direction:column;gap:var(--s2);margin:var(--s4) 0}
.reach .r{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3);
  border-radius:var(--r-sm);font-size:var(--t-sm);font-weight:600}
.reach .r.yes{background:var(--ok-soft);color:var(--ok)}
.reach .r.no{background:var(--warn-soft);color:var(--warn)}
.reach .r .ic{flex:0 0 auto;line-height:1.4}
.calllist{list-style:none;margin:var(--s3) 0 0;padding:0;
  display:flex;flex-direction:column;gap:2px}
.calllist li{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap;
  padding:var(--s2) var(--s3);background:var(--surface-2);border-radius:var(--r-sm)}
.calllist .nm{font-weight:650;flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.calllist a.tel{font-variant-numeric:tabular-nums;font-weight:650;
  text-decoration:none;white-space:nowrap}

/* Quiet label above a card, for pages with more than one section. */
.secl{margin:var(--s5) 0 var(--s2);font-size:var(--t-xs);font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3)}

/* ---- patient visit timeline ---- */
/* A rail down the card with a node per visit, so a run of visits reads as a
   history rather than as a list of unrelated rows. */
.tl{position:relative;padding:var(--s3) 0}
.tl::before{content:'';position:absolute;left:calc(var(--s5) + 5px);
  top:var(--s5);bottom:var(--s5);width:2px;background:var(--line)}
/* One visit is not a sequence — the rail would just be a stray vertical line. */
.tl.single::before{display:none}
.visit{position:relative;padding:var(--s3) var(--s5) var(--s3) calc(var(--s5) + 26px)}
/* Solid enough to read as a marker: a tinted dot on a tinted card disappeared. */
.visit::after{content:'';position:absolute;left:var(--s5);top:calc(var(--s3) + 5px);
  width:12px;height:12px;border-radius:50%;background:var(--ink-3);
  box-shadow:0 0 0 4px var(--surface)}
/* Named v-* rather than ok/bad: a bare .ok is already the flash-message rule
   further down this sheet, and it was winning on padding as well as colour. */
.visit.v-ok::after{background:var(--ok)}
.visit.v-bad::after{background:var(--danger)}
.visit.v-bad .vdate{color:var(--ink-3)}
.vhead{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap}
.vdate{font-weight:700;font-size:var(--t-md)}
.vmeta{display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:3px;
  font-size:var(--t-xs);color:var(--ink-3);font-variant-numeric:tabular-nums}
.tlmore{padding:var(--s3) var(--s5);font-size:var(--t-xs);color:var(--ink-3);
  text-align:center}
@media (max-width:600px){
  .tl::before{left:calc(var(--s4) + 5px)}
  .visit{padding:var(--s3) var(--s4) var(--s3) calc(var(--s4) + 24px)}
  .visit::after{left:var(--s4)}
}

/* ---- documents on a visit ---- */
.docs{margin-top:var(--s3);display:flex;flex-direction:column;gap:3px}
.doc{display:flex;align-items:center;gap:var(--s3);padding:var(--s2) var(--s3);
  background:var(--surface-2);border-radius:var(--r-sm);font-size:var(--t-sm)}
.doc .ic{flex:0 0 auto;font-size:var(--t-md);line-height:1}
.doc .nm{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;
  color:var(--ink);text-decoration:none;font-weight:600}
.doc .nm:hover{color:var(--accent);text-decoration:underline}
.doc .sz{flex:0 0 auto;font-size:var(--t-xs);color:var(--ink-3);
  font-variant-numeric:tabular-nums}
.doc form{flex:0 0 auto;margin:0}
.doc .del{width:auto;margin:0;padding:4px 8px;min-height:32px;background:none;
  border:0;color:var(--ink-3);font-size:var(--t-xs);font-weight:650;cursor:pointer}
.doc .del:hover{color:var(--danger);background:var(--danger-soft)}
details.note.up>summary::before{content:'+';font-weight:700}
details.note.up input[type=file]{font-size:var(--t-sm);margin-top:var(--s1);
  display:block;max-width:100%}
details.note.up .hint{font-size:var(--t-xs);color:var(--ink-3);margin:var(--s1) 0 0}

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
input[type=text],input[type=number],input[type=password],input[type=date],select,textarea{
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

/* ---- queue sections (added with the lifecycle rework) ---- */
h2.secl{
  font-size:var(--t-sm);font-weight:600;color:var(--ink-3);
  letter-spacing:.04em;text-transform:uppercase;
  margin:var(--s5) 0 var(--s2);
}
details.closed-section{padding:0}
details.closed-section>summary{
  padding:var(--s4);cursor:pointer;font-weight:600;color:var(--ink-2);
  font-size:var(--t-sm);min-height:var(--tap);display:flex;align-items:center;
}
details.closed-section[open]>summary{border-bottom:1px solid var(--line)}

/* The overflow keeps every other valid move one tap away without giving it the
   same weight as the action the card is actually for. */
details.overflow{position:relative}
details.overflow>summary{
  list-style:none;cursor:pointer;
  min-width:var(--tap);min-height:var(--tap);
  display:flex;align-items:center;justify-content:center;
  border:1px solid var(--line-2);border-radius:var(--r-sm);
  font-size:var(--t-sm);color:var(--ink-2);padding:0 var(--s3);
}
details.overflow>summary::-webkit-details-marker{display:none}
details.overflow .menu-items{
  position:absolute;right:0;top:calc(100% + 4px);z-index:5;
  background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-md);box-shadow:var(--shadow-2);
  padding:var(--s1);display:flex;flex-direction:column;gap:var(--s1);min-width:150px;
}
details.overflow .menu-items button{width:100%;text-align:left}

/* Masked phone: enough to confirm who this is, not enough to read out loud. */
.sub .mask{font-variant-numeric:tabular-nums;color:var(--ink-3)}

/* Amber at 15 minutes, red past 30 — always beside the words, never instead. */
.waited.warn{background:var(--warn-soft);color:var(--warn)}

/* Desk screens: the thing you act on and the list you act from, side by side. */
@media (min-width:1024px){
  .queue-2col{
    display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);
    gap:var(--s5);align-items:start;
  }
  .queue-2col>.col-live{position:sticky;top:var(--s4)}
  /* The first section heading would otherwise push the right column down past
     the hero it sits beside. */
  .queue-2col>.col-list>h2.secl:first-child{margin-top:0}
  /* minmax(0,1fr) above lets the column shrink; without min-width:0 here the
     grid refuses to and the name wraps one letter per line. */
  .queue-2col>.col-list{min-width:0}
  .queue-2col .qrow .body{min-width:0}
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
  /**
   * Skip the <main> wrapper. The doctor console supplies its own header, main
   * and fixed bottom bar, and wrapping those in another <main> both nests the
   * landmark and pulls the full-width header into the 760px content column.
   */
  bare?: boolean;
}

const ADMIN_NAV: { brand: string; links: NavLink[]; logoutAction: string } = {
  brand: 'Clinic Console',
  links: [{ href: '/app/doctors', label: 'Doctors' }],
  logoutAction: '/app/logout',
};

/**
 * `script` is emitted at the end of <body>, not in <head>.
 *
 * In <head> it runs while the body is still being parsed, so every
 * getElementById returns null and the handler silently binds to nothing — which
 * is exactly how the photo picker and the queue poll were both dead on arrival.
 */
export function page(opts: LayoutOptions, body: RawHtml, script?: RawHtml): string {
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
        ${opts.bare ? body : html`<main>${body}</main>`}
        ${script ?? ''}
      </body>
    </html>
  `;
  return head.__html;
}
