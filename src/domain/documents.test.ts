import { describe, expect, it } from 'vitest';
import { parseDataUri, safeFilename } from './documents';
import { ACCEPTED_TYPES, UPLOAD_MAX_BYTES } from './storage';

/**
 * These are lab reports and prescriptions — the most sensitive thing the product
 * stores, and the bytes come straight from a form field. The parser is the only
 * thing standing between "a doctor picked a file" and "we persisted whatever was
 * posted", so it is tested the same way the profile photo guard is.
 */
describe('parseDataUri', () => {
  it('accepts the types the upload path produces', () => {
    for (const type of ACCEPTED_TYPES) {
      const parsed = parseDataUri(`data:${type};base64,QUJD`);
      expect(parsed?.contentType).toBe(type);
      expect(parsed?.body.toString()).toBe('ABC');
    }
  });

  it('rejects anything that is not a base64 data: URI', () => {
    expect(parseDataUri('javascript:alert(1)')).toBeNull();
    expect(parseDataUri('https://evil.example/report.pdf')).toBeNull();
    // Not base64-encoded, so the payload never reaches the decoder.
    expect(parseDataUri('data:image/png,<svg onload=alert(1)>')).toBeNull();
  });

  it('rejects base64 with characters outside the alphabet', () => {
    // Node's decoder silently skips junk; the regex is what actually rejects it,
    // so a payload smuggling markup past a lenient decode never gets stored.
    expect(parseDataUri('data:image/png;base64,AA<script>AA')).toBeNull();
    expect(parseDataUri('data:image/png;base64,AA AA')).toBeNull();
    expect(parseDataUri('data:image/png;base64,"onerror="')).toBeNull();
  });

  it('rejects an empty payload', () => {
    expect(parseDataUri('data:image/png;base64,')).toBeNull();
  });

  it('treats missing and non-string values as no file, not an error', () => {
    expect(parseDataUri(undefined)).toBeNull();
    expect(parseDataUri(null)).toBeNull();
    expect(parseDataUri('')).toBeNull();
    expect(parseDataUri(42)).toBeNull();
    expect(parseDataUri({})).toBeNull();
  });

  /**
   * parseDataUri reads the type but does not decide on it — addDocument checks it
   * against the driver's allow-list. SVG parses fine here and must be refused
   * there, for the reason Doctor.photo refuses it: it can carry script.
   */
  it('parses SVG but SVG is not on the accepted list', () => {
    expect(parseDataUri('data:image/svg+xml;base64,PHN2Zz4=')).not.toBeNull();
    expect(ACCEPTED_TYPES).not.toContain('image/svg+xml');
    expect(ACCEPTED_TYPES).not.toContain('text/html');
  });

  it('decodes to the byte length the size check is applied to', () => {
    // 3 base64 chars per 4 bytes: the cap must bite on decoded size, not on the
    // ~33%-larger string that arrived.
    const body = 'x'.repeat(3000);
    const parsed = parseDataUri(`data:image/jpeg;base64,${Buffer.from(body).toString('base64')}`);
    expect(parsed?.body.length).toBe(3000);
    expect(parsed!.body.length).toBeLessThan(UPLOAD_MAX_BYTES);
  });
});

describe('safeFilename', () => {
  it('keeps an ordinary name intact', () => {
    expect(safeFilename('blood-report-sep.pdf')).toBe('blood-report-sep.pdf');
    expect(safeFilename('ರಕ್ತ ವರದಿ.pdf')).toBe('ರಕ್ತ ವರದಿ.pdf');
  });

  it('neutralises path traversal', () => {
    // The name never decides where bytes go — the key is built from ids — but it
    // should not look like a path either.
    expect(safeFilename('../../etc/passwd')).toBe('etc_passwd');
    expect(safeFilename('C:\\Windows\\system32\\x.png')).toBe('C:_Windows_system32_x.png');
  });

  it('strips control characters that would split a response header', () => {
    // The name is echoed into Content-Disposition on the download route.
    expect(safeFilename('report\r\nX-Injected: 1.pdf')).toBe('reportX-Injected: 1.pdf');
    expect(safeFilename('a\u0000b.png')).toBe('ab.png');
  });

  it('falls back to a placeholder rather than an empty name', () => {
    expect(safeFilename('')).toBe('document');
    expect(safeFilename('   ')).toBe('document');
    expect(safeFilename('...')).toBe('document');
    expect(safeFilename(undefined)).toBe('document');
    expect(safeFilename(123)).toBe('document');
  });

  it('bounds the length', () => {
    expect(safeFilename('a'.repeat(500))).toHaveLength(120);
  });
});
