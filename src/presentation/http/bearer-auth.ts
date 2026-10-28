import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HTTP_ERRORS, sendError } from './errors.js';

const BEARER_PREFIX = /^Bearer /i;

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Requires `Authorization: Bearer <token>`. Both sides are hashed first so the
 * comparison is constant-time and a token of another length never throws.
 */
export function requireBearerToken(token: string): RequestHandler {
  const expected = digest(token);
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (header && BEARER_PREFIX.test(header)) {
      const received = digest(header.replace(BEARER_PREFIX, ''));
      if (timingSafeEqual(received, expected)) {
        next();
        return;
      }
    }
    res.set('WWW-Authenticate', 'Bearer');
    sendError(res, HTTP_ERRORS.unauthorized);
  };
}
