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

const STYLES = `
:root{--bg:#f6f7f9;--fg:#1b1f24;--muted:#5a6572;--line:#dfe3e8;--accent:#1668b3;--danger:#b3261e;--ok:#1c7c3f;--card:#fff}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg)}
a{color:var(--accent)}
header.top{background:var(--card);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
header.top h1{font-size:16px;margin:0;font-weight:600}
header.top nav{margin-left:auto;display:flex;gap:14px;align-items:center}
main{max-width:900px;margin:0 auto;padding:24px 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:20px;margin-bottom:18px}
h2{font-size:18px;margin:0 0 4px}
p.sub{color:var(--muted);margin:0 0 18px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
label{display:block;margin:14px 0 4px;font-weight:500;font-size:14px}
.hint{font-weight:400;color:var(--muted);font-size:13px}
input[type=text],input[type=number],input[type=password],select,textarea{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:6px;font:inherit;background:#fff;color:inherit}
textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:10px 16px;font:inherit;font-weight:500;cursor:pointer;margin-top:18px}
button.secondary{background:#eceff2;color:var(--fg)}
button.danger{background:var(--danger)}
.row{display:flex;gap:16px;flex-wrap:wrap}
.row>div{flex:1 1 200px}
.err{background:#fdeceb;border:1px solid #f3c3bf;color:var(--danger);padding:10px 12px;border-radius:6px;margin-bottom:16px}
.ok{background:#e9f6ed;border:1px solid #bfe2cb;color:var(--ok);padding:10px 12px;border-radius:6px;margin-bottom:16px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:500;background:#eceff2;color:var(--muted)}
.pill.active{background:#e9f6ed;color:var(--ok)}
.pill.disabled{background:#fdeceb;color:var(--danger)}
code{background:#eceff2;padding:1px 5px;border-radius:4px;font-size:13px;word-break:break-all}
.muted{color:var(--muted)}
.login{max-width:380px;margin:9vh auto}
.actions{display:flex;gap:10px;align-items:center}
.actions form{display:inline}
@media(max-width:600px){main{padding:16px 12px}.card{padding:16px}}
`;

export interface LayoutOptions {
  title: string;
  /** Omitted on the login page, which has no session and no nav. */
  csrfToken?: string;
  nav?: boolean;
}

export function page(opts: LayoutOptions, body: RawHtml): string {
  const head = html`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${opts.title} · Clinic Console</title>
        ${opts.csrfToken ? html`<meta name="csrf-token" content="${opts.csrfToken}" />` : ''}
        <style>
          ${raw(STYLES)}
        </style>
      </head>
      <body>
        ${opts.nav
          ? html`<header class="top">
              <h1>Clinic Console</h1>
              <nav>
                <a href="/app/doctors">Doctors</a>
                <form method="post" action="/app/logout">
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
