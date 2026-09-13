import { describe, expect, it } from 'vitest';
import { bookingLink, qrSvg } from './qr';

describe('bookingLink', () => {
  it('strips formatting so a stored number in any shape still dials', () => {
    expect(bookingLink('+1 555-301-2465')).toBe('https://wa.me/15553012465?text=hi');
    expect(bookingLink('15553012465')).toBe('https://wa.me/15553012465?text=hi');
  });
});

describe('qrSvg', () => {
  it('produces a self-contained svg with a quiet zone', () => {
    const svg = qrSvg('https://wa.me/15553012465?text=hi', { title: 'Scan to book' }).__html;

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Scan to book"');
    // A white backing rect matters: scanners fail on a transparent QR over a
    // coloured page background.
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('<path d="M');

    // viewBox must exceed the module count by the 4-module quiet zone on each
    // side, or scanners cannot find the finder patterns.
    const box = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(box).not.toBeNull();
    const size = Number(box?.[1]);
    expect(size).toBe(Number(box?.[2]));
    expect(size).toBeGreaterThan(8);
  });

  it('escapes the accessible label rather than injecting it raw', () => {
    const svg = qrSvg('https://example.com', { title: '"><script>alert(1)</script>' }).__html;
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('grows the symbol for longer payloads', () => {
    const shortSize = Number(/viewBox="0 0 (\d+)/.exec(qrSvg('hi', { title: 'a' }).__html)?.[1]);
    const longSize = Number(
      /viewBox="0 0 (\d+)/.exec(qrSvg('x'.repeat(300), { title: 'a' }).__html)?.[1],
    );
    expect(longSize).toBeGreaterThan(shortSize);
  });
});
