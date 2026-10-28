import type { Logger } from 'pino';
import type { WindowRateLimiter } from '../rate-limit/window-rate-limiter.js';

export interface LimitedFetchOptions {
  service: string;
  limiter: WindowRateLimiter;
  timeoutMs: number;
  logger: Pick<Logger, 'warn'>;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

export type HttpOutcome = { ok: true; status: number; body: unknown } | { ok: false };

export async function limitedFetch(
  url: string,
  options: LimitedFetchOptions,
): Promise<HttpOutcome> {
  const { service, limiter, timeoutMs, logger, headers, fetch = globalThis.fetch } = options;
  if (!limiter.tryAcquire()) {
    logger.warn({ url }, `${service} rate limit reached, skipping call`);
    return { ok: false };
  }
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const body: unknown = await response.json().catch(() => undefined);
    return { ok: true, status: response.status, body };
  } catch (error) {
    logger.warn({ url, err: error }, `${service} request failed`);
    return { ok: false };
  }
}
