import { html, raw, type RawHtml } from './layout';

/**
 * The waiting-room board: a wall screen patients read from across the room.
 *
 * Its own visual world, deliberately not layout.ts. The console's warm light
 * ground is tuned for a phone held at arm's length; this is the opposite
 * problem — three to five metres away, often across a sunlit room, on whatever
 * screen the clinic already owns. So: near-black ground, one enormous number,
 * and almost nothing else competing with it.
 *
 * System fonts on purpose. A webfont that fails to load on a cheap TV browser
 * would reflow the one thing on screen that matters, and the board's impact
 * comes from scale and contrast rather than from a typeface.
 *
 * No patient names. A waiting room is a room full of strangers, and a screen
 * naming patients publishes personal data to all of them. The board shows the
 * number; the receptionist calls the name.
 */

export interface BoardData {
  clinicName: string;
  doctorName: string;
  specialty: string | null;
  /** What the queue is counted in. */
  mode: 'TOKEN' | 'SLOT';
  /** "6" or "10:40 AM". Null when nobody has been called in yet. */
  nowServing: string | null;
  /** The next few, in order. Labels only — never names. */
  next: string[];
  waiting: number;
  delayMins: number;
  isClosed: boolean;
  /** Dialable digits, for the "book next time" strip. Omitted if unknown. */
  whatsappNumber: string | null;
  /** Clock time this was rendered, in the clinic's timezone. */
  updatedAt: string;
}

/**
 * A single dark palette, committed to rather than theme-aware: this screen hangs
 * on a wall and its surroundings do not change with anyone's OS setting. The
 * accent is the product's teal, lifted to hold its own against near-black.
 */
const TOKENS = `
:root{
  --ground:#080f0e;
  --panel:#101b19;
  --line:#1e2f2c;
  --ink:#f2f7f5;
  --ink-2:#9db3ae;
  --accent:#4fd1c5;
  --warn:#f2b45c;
}
`;

/** The half that changes. Rendered on first paint and again on every poll. */
export function boardMain(d: BoardData): RawHtml {
  if (d.isClosed) {
    return html`
      <div class="state">
        <p class="label">Booking closed for today</p>
        <p class="closed">See you tomorrow</p>
        ${d.waiting > 0
          ? html`<p class="sub">${String(d.waiting)} still waiting to be seen</p>`
          : ''}
      </div>
    `;
  }

  if (!d.nowServing) {
    return html`
      <div class="state">
        <p class="label">Not started yet</p>
        <p class="closed">${d.waiting > 0 ? 'Please take a seat' : 'No one waiting'}</p>
        ${d.waiting > 0
          ? html`<p class="sub">${String(d.waiting)} waiting</p>`
          : ''}
      </div>
    `;
  }

  return html`
    <div class="state">
      <p class="label">${d.mode === 'TOKEN' ? 'Now serving' : 'Now seeing'}</p>
      <p class="hero">${d.mode === 'TOKEN' ? html`<span class="hash">#</span>` : ''}${d.nowServing}</p>
      ${d.next.length
        ? html`
            <div class="next">
              <span class="next-label">Next</span>
              ${raw(
                d.next
                  .map(
                    (n, i) =>
                      `<span class="chip${i === 0 ? ' up' : ''}">${escapeChip(n)}</span>`,
                  )
                  .join(''),
              )}
            </div>
          `
        : html`<p class="sub">Last patient in the queue</p>`}
    </div>
  `;
}

/** Minimal escape for the chip strings we build by hand above. */
function escapeChip(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function boardPage(d: BoardData): string {
  const body = html`
    <div class="board" id="board">
      <header class="top">
        <div>
          <p class="clinic">${d.clinicName}</p>
          <p class="doctor">
            Dr. ${d.doctorName}${d.specialty ? html` · <span>${d.specialty}</span>` : ''}
          </p>
        </div>
        <p class="clock" id="clock">${d.updatedAt}</p>
      </header>

      <main id="main">${boardMain(d)}</main>

      <footer class="bottom">
        ${d.delayMins > 0
          ? html`<p class="delay">Running about ${String(d.delayMins)} minutes late — thank you for your patience</p>`
          : html`<p class="quiet">&nbsp;</p>`}
        ${d.whatsappNumber
          ? html`<p class="book">Book on WhatsApp · <strong>+${d.whatsappNumber}</strong></p>`
          : ''}
      </footer>
    </div>
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeChip(d.clinicName)} — now serving</title>
<style>${TOKENS}${STYLES}</style>
</head>
<body>
${body.__html}
<script>${POLL}</script>
</body>
</html>`;
}

const STYLES = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  background:var(--ground);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Kannada",sans-serif;
  font-weight:600;
  -webkit-font-smoothing:antialiased;
  overflow:hidden;
}
.board{height:100%;display:flex;flex-direction:column;padding:2.2vmin 3vmin;gap:1vmin}

/* ---- identity strip ---- */
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:2vmin;
  border-bottom:1px solid var(--line);padding-bottom:1.6vmin}
.clinic{font-size:2.6vmin;letter-spacing:-.01em}
.doctor{font-size:2vmin;color:var(--ink-2);font-weight:500;margin-top:.4vmin}
.clock{font-size:2vmin;color:var(--ink-2);font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap}

/* ---- the number, which is the whole point ---- */
main{flex:1;display:grid;place-items:center;min-height:0}
.state{text-align:center;display:flex;flex-direction:column;align-items:center;gap:1vmin}
.label{font-size:3vmin;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);font-weight:600}
/* Sized for the back of the room rather than for the layout. On a 1080p screen
   this is ~430px tall, which is the point: a patient glances up from six metres
   and does not squint. */
.hero{
  font-size:40vmin;line-height:.86;letter-spacing:-.03em;font-weight:800;
  font-variant-numeric:tabular-nums;
}
.hash{color:var(--ink-2);font-size:.42em;vertical-align:.5em;margin-right:.06em}
.closed{font-size:9vmin;line-height:1.05;font-weight:700;color:var(--ink)}
.sub{font-size:2.6vmin;color:var(--ink-2);font-weight:500}

/* ---- what is coming ---- */
.next{display:flex;align-items:center;gap:1.4vmin;flex-wrap:wrap;justify-content:center;margin-top:1.4vmin}
.next-label{font-size:1.9vmin;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-2);font-weight:600}
.chip{
  font-size:3.4vmin;font-weight:700;font-variant-numeric:tabular-nums;
  background:var(--panel);border:1px solid var(--line);color:var(--ink-2);
  border-radius:1.2vmin;padding:.7vmin 1.8vmin;
}
.chip.up{color:var(--ink);border-color:var(--accent)}

/* ---- footer ---- */
.bottom{display:flex;align-items:baseline;justify-content:space-between;gap:2vmin;
  border-top:1px solid var(--line);padding-top:1.4vmin}
.delay{font-size:2.2vmin;color:var(--warn);font-weight:600}
.quiet{font-size:2.2vmin}
.book{font-size:2.2vmin;color:var(--ink-2);font-weight:500;white-space:nowrap}
.book strong{color:var(--ink);font-variant-numeric:tabular-nums}

/* Losing the network must not blank the room's screen: keep the last state on
   display and say so quietly, rather than showing an error nobody can act on. */
body.stale .board{opacity:.55}
body.stale .clock::after{content:" · reconnecting";color:var(--warn)}

/* A phone or small tablet propped on the desk. */
@media (max-aspect-ratio: 3/4){
  .hero{font-size:28vmin}
  .bottom{flex-direction:column;align-items:flex-start;gap:.6vmin}
  .book{white-space:normal}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

/**
 * Polls for the changing half and swaps it in.
 *
 * Written to run for days on a device nobody is watching: no timers stacking
 * up, no state that grows, and a failed fetch leaves the last good screen alone
 * rather than clearing it. Two consecutive failures dim the board so staff can
 * see it has lost touch, without a dialog nobody is there to dismiss.
 */
const POLL = `
(function(){
  var fails=0;
  function tick(){
    fetch(location.pathname+'?fragment=1',{cache:'no-store'})
      .then(function(r){ if(!r.ok) throw new Error('bad status'); return r.json(); })
      .then(function(d){
        document.getElementById('main').innerHTML=d.main;
        document.getElementById('clock').textContent=d.clock;
        fails=0; document.body.classList.remove('stale');
      })
      .catch(function(){ if(++fails>=2) document.body.classList.add('stale'); })
      .then(function(){ setTimeout(tick,15000); });
  }
  setTimeout(tick,15000);
})();
`;
