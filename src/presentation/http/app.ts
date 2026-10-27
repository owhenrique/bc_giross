import express from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { clearCache } from '../../application/clear-cache.js';
import type { findNearbyCeps } from '../../application/find-nearby-ceps.js';
import { cacheRouter } from './cache-route.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { nearbyCepsRouter } from './nearby-ceps-route.js';

export interface AppDeps {
  findNearbyCeps: ReturnType<typeof findNearbyCeps>;
  logger: Logger;
  /** When absent, the cache admin routes are not registered and fall to the 404 handler. */
  cacheAdmin?: { clearCache: ReturnType<typeof clearCache>; token: string };
}

export function createApp({ findNearbyCeps: find, logger, cacheAdmin }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(nearbyCepsRouter(find));
  if (cacheAdmin) app.use(cacheRouter(cacheAdmin.clearCache, cacheAdmin.token));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
