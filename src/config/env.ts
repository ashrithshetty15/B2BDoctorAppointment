import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  /**
   * BullMQ key namespace. Two stacks pointed at one Redis (e.g. a local console
   * instance alongside the deployed one) would otherwise consume each other's
   * jobs; giving one a different prefix keeps the queues disjoint.
   */
  REDIS_QUEUE_PREFIX: z.string().min(1).default('bull'),

  MESSAGING_PROVIDER: z.enum(['whatsapp_cloud', 'console']).default('console'),

  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().default('change-me'),
  WHATSAPP_APP_SECRET: z.string().optional(),

  DEFAULT_DOCTOR_ID: z.string().optional(),
  /** Idle expiry for a patient's WhatsApp conversation state. */
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  ADMIN_API_KEY: z.string().default('change-me'),

  // ---- Dashboard web login ----
  // Named DASHBOARD_* to keep them clearly distinct from SESSION_TTL_MINUTES
  // above, which governs the unrelated WhatsApp conversation state.
  /** HMAC key for dashboard session cookies. Required in production. */
  DASHBOARD_SESSION_SECRET: z.string().min(32).optional(),
  DASHBOARD_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),

  // ---- Patient document storage ----
  // 'db' keeps small images as base64 in the documents row. It is the default so
  // a deployment without object storage still works, but it cannot take a PDF:
  // the /app urlencoded parser caps bodies at 600kb and base64 inflates ~33%.
  // 's3' presigns uploads straight to the bucket, so the bytes never pass through
  // this process and neither limit applies.
  STORAGE_DRIVER: z.enum(['db', 's3']).default('db'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

if (env.MESSAGING_PROVIDER === 'whatsapp_cloud' && !env.WHATSAPP_ACCESS_TOKEN) {
  throw new Error('MESSAGING_PROVIDER=whatsapp_cloud requires WHATSAPP_ACCESS_TOKEN');
}

// Fail at boot rather than at the moment a doctor tries to upload a report: a
// half-configured bucket looks fine until someone needs it.
if (env.STORAGE_DRIVER === 's3') {
  const missing = (
    ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const
  ).filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=s3 requires ${missing.join(', ')}`);
  }
}

// Without a stable secret, dashboard cookies would be signed with a key that
// changes on every restart — every doctor silently logged out on each deploy.
if (env.NODE_ENV === 'production' && !env.DASHBOARD_SESSION_SECRET) {
  throw new Error(
    'DASHBOARD_SESSION_SECRET (>=32 chars) is required in production; generate one with: openssl rand -hex 32',
  );
}
