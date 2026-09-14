import { describe, expect, it } from 'vitest';
import { presign, uriEncode } from './storage';

/**
 * SigV4 is signed by hand rather than pulled in with @aws-sdk/client-s3 (~20MB
 * for what is an HMAC chain), so it has to be checked against something
 * authoritative. AWS publishes a worked presigned-GET example with the expected
 * signature; if this test passes, the chain is right.
 *
 * Note what this does *not* prove: it has never been run against a live R2
 * bucket, because there are no credentials yet. The first real upload is the
 * actual proof.
 */
describe('presign (AWS SigV4, query-parameter signing)', () => {
  // From the AWS docs' worked example for a presigned GET.
  const EXAMPLE = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    expiresIn: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  };

  it('reproduces the published signature', () => {
    const signed = presign({ method: 'GET', ...EXAMPLE });
    expect(signed).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('emits the X-Amz parameters the service expects', () => {
    const url = new URL(presign({ method: 'GET', ...EXAMPLE }));
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
    );
    expect(url.searchParams.get('X-Amz-Date')).toBe('20130524T000000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('86400');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('signs the method, so a GET URL cannot be replayed as a PUT', () => {
    const get = presign({ method: 'GET', ...EXAMPLE });
    const put = presign({ method: 'PUT', ...EXAMPLE });
    expect(get).not.toBe(put);
  });

  it('folds extra query parameters into the signature', () => {
    const plain = presign({ method: 'GET', ...EXAMPLE });
    const withDisposition = presign({
      method: 'GET',
      ...EXAMPLE,
      query: { 'response-content-disposition': 'attachment; filename="report.pdf"' },
    });
    expect(withDisposition).not.toBe(plain);
    // Unsigned extras would be silently dropped or rejected by the service.
    expect(withDisposition).toContain('response-content-disposition=');
  });
});

describe('uriEncode', () => {
  /**
   * encodeURIComponent leaves !'()* alone; AWS requires them escaped. A key
   * containing one would otherwise produce a signature the service cannot match.
   */
  it("escapes the characters encodeURIComponent leaves alone", () => {
    expect(uriEncode("!'()*", true)).toBe('%21%27%28%29%2A');
  });

  it('leaves unreserved characters untouched', () => {
    expect(uriEncode('aZ0-._~', true)).toBe('aZ0-._~');
  });

  it('treats the slash according to the flag', () => {
    // Paths keep their separators; query values must escape them.
    expect(uriEncode('a/b', false)).toBe('a/b');
    expect(uriEncode('a/b', true)).toBe('a%2Fb');
  });

  it('percent-encodes multi-byte characters per UTF-8 byte', () => {
    expect(uriEncode('ಕ', true)).toBe('%E0%B2%95');
  });

  it('escapes spaces as %20, not +', () => {
    expect(uriEncode('a b', true)).toBe('a%20b');
  });
});
