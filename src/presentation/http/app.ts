import express from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { findNearbyCeps } from '../../application/find-nearby-ceps.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { nearbyCepsRouter } from './nearby-ceps-route.js';

export interface AppDeps {
  findNearbyCeps: ReturnType<typeof findNearbyCeps>;
  logger: Logger;
}

export function createApp({ findNearbyCeps: find, logger }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(nearbyCepsRouter(find));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
