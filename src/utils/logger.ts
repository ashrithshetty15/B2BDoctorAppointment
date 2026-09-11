import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino/file', options: { destination: 1 } } }
    : {}),
  redact: {
    // `cookie` / `set-cookie` matter as much as the API key: the dashboard's
    // session cookie is bearer-equivalent, and pino-http serialises request
    // headers, so without these every /app request would log a usable session.
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'accessToken',
    ],
    remove: true,
  },
});
