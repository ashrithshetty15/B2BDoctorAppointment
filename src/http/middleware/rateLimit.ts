import type { NextFunction, Request, Response } from 'express';

/**
 * Minimal fixed-window rate limiter, no dependency.
 *
 * Used only on the dashboard login route. It is per-process and resets on
 * deploy, which is fine: the real defence is that an API key is 48 unguessable
 * hex chars. This exists to keep brute-force noise out of the logs and off the
 * database, not as the primary control.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_KEYS = 1000;

export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  function prune(now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();

    // Bound memory: only sweep when the map actually grows large.
    if (buckets.size > MAX_TRACKED_KEYS) prune(now);

    // req.ip is meaningful because app.set('trust proxy', 1) is configured.
    const key = req.ip ?? 'unknown';
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      return;
    }

    next();
  };
}
