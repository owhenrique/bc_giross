import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import { HTTP_ERRORS, sendError } from '../errors/errors.js';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  logger: Pick<Logger, 'warn' | 'error'>;
}

/** Counts per IP in the library's default in-memory store (per process). */
export function rateLimitMiddleware({ limit, windowMs, logger }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // The library sets `req.rateLimit` only after counting, so a second pass over the same
    // request is skipped before incrementing: one count per client request (see D30: internal
    // composition is in-process, never an HTTP call to the API itself).
    skip: (req) => (req as { rateLimit?: unknown }).rateLimit !== undefined,
    logger,
    // The library sets Retry-After and the RateLimit headers before calling the handler.
    handler: (_req, res) => sendError(res, HTTP_ERRORS.rateLimitExceeded),
  });
}
