import { rateLimit, type Store } from 'express-rate-limit';
import type { Logger } from 'pino';
import { RateLimitExceededError } from '../../application/errors.js';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Defaults to the library's in-memory store (tests). */
  store?: Store;
  logger: Pick<Logger, 'warn'>;
}

export function rateLimitMiddleware({ limit, windowMs, store, logger }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Fail open: a store failure lets the request through (and is logged).
    passOnStoreError: true,
    store,
    // The library sets `req.rateLimit` only after counting, so a second pass over the same
    // request is skipped before incrementing: one count per client request (see D30: internal
    // composition is in-process, never an HTTP call to the API itself).
    skip: (req) => (req as { rateLimit?: unknown }).rateLimit !== undefined,
    // Store failures are degradation, not errors, so both levels log as warnings.
    logger: {
      error: (err: unknown, msg?: string) => logger.warn({ err }, msg),
      warn: (message: unknown) => logger.warn(String(message)),
    },
    handler: (_req, _res, next) => next(new RateLimitExceededError()),
  });
}
