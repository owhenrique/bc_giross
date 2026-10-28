import express from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { clearCache } from '../../application/cache/clear-cache.js';
import type { findNearbyCeps } from '../../application/use-cases/find-nearby-ceps.js';
import { cacheRouter } from './routes/cache-route.js';
import { docsRouter } from './routes/docs-route.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { healthRouter } from './routes/health-route.js';
import { nearbyCepsRouter } from './routes/nearby-ceps-route.js';
import { rateLimitMiddleware } from './middlewares/rate-limit.js';

export interface AppDeps {
  findNearbyCeps: ReturnType<typeof findNearbyCeps>;
  logger: Logger;
  cacheAdmin?: { clearCache: ReturnType<typeof clearCache>; token: string };
  rateLimit: { limit: number; windowMs: number };
  openApiDocument?: object;
  trustProxy?: boolean | number | string;
}

export function createApp({
  findNearbyCeps: find,
  logger,
  cacheAdmin,
  rateLimit,
  trustProxy,
  openApiDocument,
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy ?? false);
  app.use(pinoHttp({ logger }));
  app.use(rateLimitMiddleware({ ...rateLimit, logger }));
  app.use(healthRouter());
  app.use(nearbyCepsRouter(find));
  if (cacheAdmin) app.use(cacheRouter(cacheAdmin.clearCache, cacheAdmin.token));
  if (openApiDocument) app.use(docsRouter(openApiDocument));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
