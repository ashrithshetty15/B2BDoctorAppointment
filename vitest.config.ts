import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The unit tests never open a connection, but importing modules that build
    // a PrismaClient requires these to be present.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://localhost:5432/test?schema=public',
      REDIS_URL: 'redis://localhost:6379',
      MESSAGING_PROVIDER: 'console',
      LOG_LEVEL: 'silent',
    },
  },
});
