import type { Request } from 'express';

/**
 * True when this looks like a browser navigation rather than an API call, so
 * an auth failure can redirect to the login page instead of returning JSON.
 */
export function wantsHtml(req: Request): boolean {
  if (req.method !== 'GET') return false;
  return req.accepts(['json', 'html']) === 'html';
}

/**
 * Only same-site relative paths under /app are safe to bounce back to after
 * login; anything else would be an open redirect.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  // Reject protocol-relative (//evil.com) and absolute URLs outright.
  if (!value.startsWith('/app') || value.startsWith('//')) return null;
  if (value.includes('\\')) return null;
  return value;
}
