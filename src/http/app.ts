import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { adminRouter } from './admin';
import { callWebhookRouter } from './call-webhook';
import { dashboardRouter } from './dashboard';
import { webhookRouter } from './webhook';

export function createApp() {
  const app = express();

  // Railway (and any PaaS) terminates TLS upstream, so req.ip is the proxy's
  // address unless we trust one hop. The login rate limiter keys off req.ip.
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        // Compare on the path, not req.url: '/health?x=1' and the cache-busted
        // '/app/assets/app.css?v=<hash>' both carry a query string.
        ignore: (req) => {
          const path = (req.url ?? '').split('?')[0] ?? '';
          return path === '/health' || path.startsWith('/app/assets/');
        },
      },
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        // The dashboard polls this every 30s per open tab.
        if ((req.url ?? '').startsWith('/app/queue?fragment')) return 'debug';
        return 'info';
      },
    }),
  );

  // rawBody is required to verify Meta's X-Hub-Signature-256 over the exact
  // bytes, but only /webhook needs it — so the copy is scoped to that path
  // rather than taken on every request. body-parser short-circuits when a body
  // is already parsed, so the global parser below is a no-op for /webhook.
  app.use(
    '/webhook',
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );

  // Exotel sends call events as form-encoded data
  app.use('/call-webhook', express.urlencoded({ extended: true }));

  // NOTE: urlencoded is deliberately absent from the global config.
  // The dashboard sends every mutation as fetch()+JSON so that a cross-site
  // <form method="post"> cannot forge one; adding urlencoded globally would
  // quietly reopen that hole. Only the call-webhook route uses it.
  app.use(express.json({ limit: '100kb' }));

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
  app.use(callWebhookRouter);
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
