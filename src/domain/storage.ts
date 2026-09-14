import { createHash, createHmac } from 'node:crypto';
import { env } from '../config/env';

/**
 * Storage for patient reference documents.
 *
 * Two drivers that differ in where the bytes *rest*, not yet in how they travel:
 *
 *   db  browser → base64 form field → this process → Postgres row
 *   s3  browser → base64 form field → this process → presigned PUT → bucket
 *
 * Both therefore share one transport ceiling. The upload form posts to /app,
 * whose urlencoded parser app.ts caps at 600kb, and base64 costs ~33% — so the
 * real limit is UPLOAD_MAX_BYTES below, whichever driver is active. The browser
 * downscales images before posting, which is what makes a 5MB phone photo of a
 * prescription fit; a PDF has to already be small.
 *
 * Lifting that ceiling means true direct upload: hand the browser a presigned
 * PUT, let it send the file straight to the bucket, and post back only the key.
 * `presign` below is the hard part of that and is already written and tested,
 * but the wiring is deliberately not built yet — there are no bucket
 * credentials to verify it against, and guessing at it would ship an untested
 * upload path for medical records.
 */

export interface StorageCapabilities {
  /** Content types the active driver will accept. */
  acceptedTypes: readonly string[];
  /** Largest file the active driver can take, in decoded bytes. */
  maxBytes: number;
}

export interface StoredObject {
  /** Set by object-storage drivers; null when the bytes live in the row. */
  storageKey: string | null;
  /** Set by the db driver; null when the bytes live in a bucket. */
  inlineData: string | null;
}

export interface StorageDriver {
  readonly name: 'db' | 's3';
  readonly capabilities: StorageCapabilities;
  /** Persist bytes already decoded and validated by the caller. */
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  /**
   * A URL the browser can fetch the object from, or null when the driver has no
   * out-of-process URL and the route must stream the bytes itself.
   */
  signedUrl(obj: StoredObject, opts: { filename: string; contentType: string }): Promise<string | null>;
  remove(obj: StoredObject): Promise<void>;
}

/**
 * Raster images plus PDF. SVG is excluded for the reason Doctor.photo excludes
 * it: it is an image type that can carry script, and these bytes are served back
 * to a logged-in browser.
 */
export const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/**
 * Decoded ceiling, set by the transport rather than by either driver: the /app
 * urlencoded limit (1mb) has to cover this much file *after* base64 and
 * percent-encoding, which together take an incompressible 400KB to ~567KB.
 *
 * 409,600 rather than 400,000 so it presents to the doctor as a round "400 KB"
 * — the hint is generated from this number, and "391 KB" reads like a bug.
 */
export const UPLOAD_MAX_BYTES = 409_600;

// ---- db driver ----

const dbDriver: StorageDriver = {
  name: 'db',
  capabilities: {
    acceptedTypes: ACCEPTED_TYPES,
    maxBytes: UPLOAD_MAX_BYTES,
  },
  async put(_key, body, _contentType) {
    return { storageKey: null, inlineData: body.toString('base64') };
  },
  async signedUrl() {
    // No external URL: the bytes are in the row, so the download route reads them
    // and streams them out under its own auth.
    return null;
  },
  async remove() {
    // Nothing outside the row to clean up; deleting the row is the delete.
  },
};

// ---- s3 driver (SigV4, no SDK) ----

/**
 * @aws-sdk/client-s3 is ~20MB of dependency for what is, at the level we use it,
 * an HMAC chain. Signing by hand keeps the image small and the behaviour legible.
 *
 * Implemented from the AWS SigV4 spec and covered by tests against AWS's own
 * published test vectors. It is *not* yet verified against a live R2 bucket —
 * there are no credentials to test with — so treat the first real upload as the
 * actual proof.
 */

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * RFC 3986 encoding. encodeURIComponent leaves !'()* alone, which AWS requires
 * to be escaped — a key containing one would otherwise produce a signature that
 * does not match what the server computes.
 */
export function uriEncode(input: string, encodeSlash: boolean): string {
  let out = '';
  for (const ch of input) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/';
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

export interface SigV4Input {
  method: string;
  /** Absolute URL of the object, e.g. https://acct.r2.cloudflarestorage.com/bucket/key */
  url: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Seconds until the signature expires. */
  expiresIn: number;
  /** Extra query parameters to sign alongside the X-Amz-* set. */
  query?: Record<string, string>;
  /** Overridden in tests so the signature is deterministic. */
  now?: Date;
}

/**
 * Build a presigned URL. Query-string signing (rather than an Authorization
 * header) is what lets the browser use the URL directly.
 */
export function presign(input: SigV4Input): string {
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  const amzDate = `${now.toISOString().slice(0, 19).replace(/[:-]/g, '')}Z`;
  const dateStamp = amzDate.slice(0, 8);

  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;

  const params: Record<string, string> = {
    ...(input.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };

  // The canonical query string is sorted by encoded key, then encoded value.
  const canonicalQuery = Object.keys(params)
    .map((k) => [uriEncode(k, true), uriEncode(params[k] ?? '', true)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    uriEncode(decodeURIComponent(url.pathname), false),
    canonicalQuery,
    `host:${url.host}\n`,
    'host',
    // Presigned requests do not hash the body; the payload is unknown at sign time.
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Presigned GETs are the credential for a medical record — keep them short-lived. */
export const DOWNLOAD_URL_TTL_SECONDS = 120;

function s3Url(key: string): string {
  const base = (env.S3_ENDPOINT ?? '').replace(/\/+$/, '');
  return `${base}/${env.S3_BUCKET}/${uriEncode(key, false)}`;
}

const s3Driver: StorageDriver = {
  name: 's3',
  capabilities: {
    acceptedTypes: ACCEPTED_TYPES,
    // Same ceiling as the db driver until direct upload is wired: the file still
    // arrives through the /app form. What s3 buys today is that medical records
    // stop living in Postgres rows, not a bigger file.
    maxBytes: UPLOAD_MAX_BYTES,
  },
  async put(key, body, contentType) {
    const url = presign({
      method: 'PUT',
      url: s3Url(key),
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      expiresIn: 300,
    });
    const res = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'content-type': contentType },
    });
    if (!res.ok) {
      throw new Error(`S3 upload failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    return { storageKey: key, inlineData: null };
  },
  async signedUrl(obj, opts) {
    if (!obj.storageKey) return null;
    return presign({
      method: 'GET',
      url: s3Url(obj.storageKey),
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      // Force a download rather than an inline render, and give the browser the
      // original name back without ever putting it in the key.
      query: {
        'response-content-disposition': `attachment; filename="${opts.filename.replace(/["\\]/g, '')}"`,
        'response-content-type': opts.contentType,
      },
    });
  },
  async remove(obj) {
    if (!obj.storageKey) return;
    const url = presign({
      method: 'DELETE',
      url: s3Url(obj.storageKey),
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      expiresIn: 300,
    });
    const res = await fetch(url, { method: 'DELETE' });
    // 404 is success for our purposes: the object is gone either way.
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 delete failed: ${res.status}`);
    }
  },
};

export function storage(): StorageDriver {
  return env.STORAGE_DRIVER === 's3' ? s3Driver : dbDriver;
}
