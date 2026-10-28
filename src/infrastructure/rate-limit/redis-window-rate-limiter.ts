import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { withTimeout } from '../cache/redis-cache.js';
import type { RateLimiter } from '../http/rate-limiter.js';

/** Minimal slice of the node-redis client used for raw commands (eases faking in tests). */
export interface RedisCommandSender {
  sendCommand(args: string[]): Promise<unknown>;
}

// Atomic sliding window over a sorted set, timed by the Redis clock so all replicas agree.
const SLIDING_WINDOW_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1`;

export interface RedisWindowRateLimiterOptions {
  key: string;
  max: number;
  windowMs: number;
  fallback: RateLimiter;
  logger: Pick<Logger, 'warn'>;
}

/** Redis-backed sliding-window limiter shared across replicas; asks `fallback` while Redis fails. */
export class RedisWindowRateLimiter implements RateLimiter {
  constructor(
    private readonly client: RedisCommandSender,
    private readonly options: RedisWindowRateLimiterOptions,
  ) {}

  async tryAcquire(): Promise<boolean> {
    const { key, max, windowMs, fallback, logger } = this.options;
    try {
      const member = `${Date.now()}-${randomUUID()}`;
      const result = await withTimeout(
        this.client.sendCommand([
          'EVAL',
          SLIDING_WINDOW_SCRIPT,
          '1',
          key,
          String(windowMs),
          String(max),
          member,
        ]),
      );
      return result === 1;
    } catch (error) {
      logger.warn({ err: error, key }, 'redis rate limiter failed, using in-memory fallback');
      return fallback.tryAcquire();
    }
  }
}
