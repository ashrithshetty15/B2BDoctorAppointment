import crypto from 'node:crypto';
import { prisma } from '../db/prisma';
import { storage } from './storage';

/**
 * Reference documents attached to a visit.
 *
 * Every function here takes a doctorId and puts it in the WHERE clause. That is
 * the whole isolation model: a document id is a uuid, but ids leak — through
 * logs, through a shared screen — and a clinic must never be able to fetch
 * another clinic's medical records by guessing or replaying one.
 */

/** Keeps one long-running patient from turning into an unbounded page. */
export const MAX_DOCS_PER_VISIT = 20;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export type UploadFailure =
  | 'NOT_FOUND'
  | 'BAD_FORMAT'
  | 'TYPE_NOT_ALLOWED'
  | 'TOO_LARGE'
  | 'TOO_MANY';

export type UploadResult = { ok: true; id: string } | { ok: false; reason: UploadFailure };

/**
 * Strip anything that would make the name dangerous to echo into a header or a
 * page, and anything that looks like a path. The name is decoration — it never
 * decides where the bytes go — but it is still attacker-controlled text.
 */
export function safeFilename(input: unknown): string {
  if (typeof input !== 'string') return 'document';
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Leading dots and separators go first: collapsing "/" to "_" beforehand
    // would leave the ".." of a "../../x" intact in the middle of the name.
    .replace(/^[./\\]+/, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 120);
  return cleaned === '' ? 'document' : cleaned;
}

/** `data:image/png;base64,AAAA` → its parts, or null if it is not that shape. */
export function parseDataUri(value: unknown): { contentType: string; body: Buffer } | null {
  if (typeof value !== 'string') return null;
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(value);
  if (!match) return null;
  const contentType = match[1]!;
  // Node's base64 decoder is lenient about junk; the regex above is what actually
  // rejects a malformed payload.
  const body = Buffer.from(match[2]!, 'base64');
  if (body.length === 0) return null;
  return { contentType, body };
}

/**
 * Accept an upload for one visit. Validates before it stores, and verifies the
 * appointment belongs to this doctor before it looks at the bytes at all.
 */
export async function addDocument(opts: {
  doctorId: string;
  appointmentId: string;
  filename: unknown;
  dataUri: unknown;
}): Promise<UploadResult> {
  const appointment = await prisma.appointment.findFirst({
    where: { id: opts.appointmentId, doctorId: opts.doctorId },
    select: { id: true },
  });
  if (!appointment) return { ok: false, reason: 'NOT_FOUND' };

  const parsed = parseDataUri(opts.dataUri);
  if (!parsed) return { ok: false, reason: 'BAD_FORMAT' };

  const driver = storage();
  if (!driver.capabilities.acceptedTypes.includes(parsed.contentType)) {
    return { ok: false, reason: 'TYPE_NOT_ALLOWED' };
  }
  if (parsed.body.length > driver.capabilities.maxBytes) {
    return { ok: false, reason: 'TOO_LARGE' };
  }

  const existing = await prisma.document.count({ where: { appointmentId: appointment.id } });
  if (existing >= MAX_DOCS_PER_VISIT) return { ok: false, reason: 'TOO_MANY' };

  // Key is built from ids and a fresh uuid — never from the supplied filename, so
  // a crafted name cannot reach across a prefix or collide with another clinic.
  const key = `doctors/${opts.doctorId}/visits/${appointment.id}/${crypto.randomUUID()}.${
    EXTENSIONS[parsed.contentType] ?? 'bin'
  }`;
  const stored = await driver.put(key, parsed.body, parsed.contentType);

  const created = await prisma.document.create({
    data: {
      appointmentId: appointment.id,
      doctorId: opts.doctorId,
      filename: safeFilename(opts.filename),
      contentType: parsed.contentType,
      sizeBytes: parsed.body.length,
      storageKey: stored.storageKey,
      inlineData: stored.inlineData,
    },
    select: { id: true },
  });

  return { ok: true, id: created.id };
}

/**
 * Fetch one document's bytes for download. Returns null for any document that is
 * not this doctor's — indistinguishable from one that does not exist, which is
 * the point.
 */
export async function getDocumentForDoctor(doctorId: string, documentId: string) {
  return prisma.document.findFirst({
    where: { id: documentId, doctorId },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      storageKey: true,
      inlineData: true,
      appointmentId: true,
    },
  });
}

/** Removes the row and, on object storage, the object behind it. */
export async function deleteDocument(doctorId: string, documentId: string): Promise<boolean> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, doctorId },
    select: { id: true, storageKey: true, inlineData: true },
  });
  if (!doc) return false;

  // Object first: a failure here leaves a row pointing at a live object, which is
  // recoverable. The reverse would strand bytes with nothing referencing them.
  await storage().remove({ storageKey: doc.storageKey, inlineData: doc.inlineData });
  await prisma.document.delete({ where: { id: doc.id } });
  return true;
}
