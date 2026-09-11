import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { adminRouter } from './admin';
import { dashboardRouter } from './dashboard';
import { webhookRouter } from './webhook';

export function createApp() {
  const app = express();

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  // rawBody is required to verify Meta's X-Hub-Signature-256 over the exact bytes.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Health check failed');
      res.status(503).json({ ok: false });
    }
  });

  app.use(webhookRouter);
  app.use(dashboardRouter);
  app.use(adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Final safety net: never leak a stack trace to a caller.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled request error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
