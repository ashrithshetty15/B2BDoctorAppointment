import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  MESSAGING_PROVIDER: z.enum(['whatsapp_cloud', 'console']).default('console'),

  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().default('change-me'),
  WHATSAPP_APP_SECRET: z.string().optional(),

  DEFAULT_DOCTOR_ID: z.string().optional(),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  ADMIN_API_KEY: z.string().default('change-me'),
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
