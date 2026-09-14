import { describe, expect, it } from 'vitest';

/**
 * Mirrors the guard in doctorConsole.ts. The stored value is echoed into an
 * <img src>, so it must be proven safe rather than trusted because our own
 * script produced it — the form field is user-controlled either way.
 */
const PHOTO_PREFIX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const PHOTO_MAX_BYTES = 400_000;

function validPhoto(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (value.length > PHOTO_MAX_BYTES) return null;
  return PHOTO_PREFIX.test(value) ? value : null;
}

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';

describe('profile photo validation', () => {
  it('accepts the raster types the browser produces', () => {
    expect(validPhoto(jpeg)).toBe(jpeg);
    expect(validPhoto('data:image/png;base64,iVBORw0KGgo=')).not.toBeNull();
    expect(validPhoto('data:image/webp;base64,UklGRh4AAABXRUJQ')).not.toBeNull();
  });

  /**
   * SVG is an image type but can carry <script>, and this value lands in an
   * <img src> on a page holding a session cookie. Excluded deliberately.
   */
  it('rejects SVG even though it is an image', () => {
    expect(validPhoto('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==')).toBeNull();
    expect(validPhoto('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull();
  });

  it('rejects script and remote URLs', () => {
    expect(validPhoto('javascript:alert(1)')).toBeNull();
    expect(validPhoto('https://evil.example/pixel.png')).toBeNull();
    expect(validPhoto('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
  });

  it('rejects an attempt to break out of the attribute', () => {
    expect(validPhoto(`${jpeg}" onerror="alert(1)`)).toBeNull();
    expect(validPhoto(`data:image/jpeg;base64,AAAA"><script>alert(1)</script>`)).toBeNull();
  });

  it('rejects a payload over the size cap', () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(PHOTO_MAX_BYTES)}`;
    expect(validPhoto(huge)).toBeNull();
  });

  it('treats empty and non-strings as "no photo supplied", not an error', () => {
    // The form always posts the field; empty means the doctor changed nothing.
    expect(validPhoto('')).toBeNull();
    expect(validPhoto(undefined)).toBeNull();
    expect(validPhoto(null)).toBeNull();
    expect(validPhoto(123)).toBeNull();
    expect(validPhoto({})).toBeNull();
  });

  it('rejects base64 containing characters outside the alphabet', () => {
    expect(validPhoto('data:image/jpeg;base64,AA<AA')).toBeNull();
    expect(validPhoto('data:image/jpeg;base64,AA AA')).toBeNull();
  });
});
