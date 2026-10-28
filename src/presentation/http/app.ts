import express from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { clearCache } from '../../application/cache/clear-cache.js';
import type { findNearbyCeps } from '../../application/use-cases/find-nearby-ceps.js';
import { cacheRouter } from './routes/cache-route.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { nearbyCepsRouter } from './routes/nearby-ceps-route.js';
import { rateLimitMiddleware } from './middlewares/rate-limit.js';

export interface AppDeps {
  findNearbyCeps: ReturnType<typeof findNearbyCeps>;
  logger: Logger;
  /** When absent, the cache admin routes are not registered and fall to the 404 handler. */
  cacheAdmin?: { clearCache: ReturnType<typeof clearCache>; token: string };
  rateLimit: { limit: number; windowMs: number };
  /** Express `trust proxy` setting; defaults to false (use the socket address). */
  trustProxy?: boolean | number | string;
}

export function createApp({
  findNearbyCeps: find,
  logger,
  cacheAdmin,
  rateLimit,
  trustProxy,
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy ?? false);
  app.use(pinoHttp({ logger }));
  app.use(rateLimitMiddleware({ ...rateLimit, logger }));
  app.use(nearbyCepsRouter(find));
  if (cacheAdmin) app.use(cacheRouter(cacheAdmin.clearCache, cacheAdmin.token));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
