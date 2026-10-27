import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { withTimeout } from '../cache/redis-cache.js';
import type { RedisCommandSender } from './redis-window-rate-limiter.js';

/** Shared counter store for the inbound rate limit; commands time out like the cache's. */
export function createRedisRateLimitStore(client: RedisCommandSender): RedisStore {
  return new RedisStore({
    prefix: 'ratelimit:api:',
    sendCommand: (...args: string[]) =>
      withTimeout(client.sendCommand(args)) as Promise<RedisReply>,
  });
}
