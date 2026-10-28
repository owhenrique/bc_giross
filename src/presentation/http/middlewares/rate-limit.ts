import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import { HTTP_ERRORS, sendError } from '../errors/errors.js';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  logger: Pick<Logger, 'warn' | 'error'>;
}

export function rateLimitMiddleware({ limit, windowMs, logger }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => (req as { rateLimit?: unknown }).rateLimit !== undefined,
    logger,
    handler: (_req, res) => sendError(res, HTTP_ERRORS.rateLimitExceeded),
  });
}
