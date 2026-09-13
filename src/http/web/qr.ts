import qr from 'qrcode-generator';
import { type RawHtml, escapeHtml, raw } from './layout';

/**
 * QR as inline SVG.
 *
 * Inline rather than an <img> because there is no static asset route, and a
 * data: URI would bloat the HTML for no benefit. One path of rectangles keeps
 * the markup small enough to re-render on every request.
 *
 * qrcode-generator is the only runtime dependency added for this: ~30KB, zero
 * transitive deps. The alternative, `qrcode`, pulls in yargs and pngjs.
 */
export function qrSvg(text: string, opts: { title: string }): RawHtml {
  // Type 0 = auto-size to the shortest version that fits. 'M' tolerates ~15%
  // damage, which matters for a code printed and taped to a reception desk.
  const code = qr(0, 'M');
  code.addData(text);
  code.make();

  const count = code.getModuleCount();
  const quiet = 4; // Required quiet zone; scanners fail without it.
  const size = count + quiet * 2;

  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (code.isDark(row, col)) {
        path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
  }

  return raw(
    `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(opts.title)}">` +
      `<rect width="${size}" height="${size}" fill="#fff"/>` +
      `<path d="${path}" fill="#1f2421"/>` +
      `</svg>`,
  );
}

/** wa.me deep link that opens WhatsApp with the first message pre-filled. */
export function bookingLink(whatsappNumber: string): string {
  const digits = whatsappNumber.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent('hi')}`;
}
