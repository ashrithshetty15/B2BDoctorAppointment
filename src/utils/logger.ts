import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino/file', options: { destination: 1 } } }
    : {}),
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-api-key"]', 'accessToken'],
    remove: true,
  },
});
