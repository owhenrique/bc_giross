import { createClient } from 'redis';
import type { Logger } from 'pino';
import type { Cache } from '../../application/cache.js';

export const CACHE_OPERATION_TIMEOUT_MS = 500;
const SCAN_COUNT = 500;

/** Minimal slice of the node-redis client used by `RedisCache` (eases faking in tests). */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string[]>;
  unlink(keys: string[]): Promise<unknown>;
}

/**
 * Creates a node-redis client that fails commands fast while disconnected
 * (no offline queue), reconnects on its own and never crashes on 'error'.
 */
export function createRedisClient(url: string, logger: Pick<Logger, 'warn'>) {
  const client = createClient({ url, disableOfflineQueue: true });
  client.on('error', (error) => logger.warn({ err: error }, 'redis client error'));
  return client;
}

/** Redis-backed cache. `get`/`set` degrade to miss/no-op; `deleteByPrefix` propagates errors. */
export class RedisCache implements Cache {
  constructor(
    private readonly client: RedisClientLike,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await withTimeout(this.client.get(key));
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'cache get failed, treating as miss');
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await withTimeout(this.client.set(key, JSON.stringify(value), { EX: ttlSeconds }));
    } catch (error) {
      this.logger.warn({ err: error, key }, 'cache set failed, skipping');
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    for await (const keys of this.client.scanIterator({ MATCH: `${prefix}*`, COUNT: SCAN_COUNT })) {
      if (keys.length > 0) await this.client.unlink(keys);
    }
  }
}

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`cache operation timed out after ${CACHE_OPERATION_TIMEOUT_MS} ms`)),
      CACHE_OPERATION_TIMEOUT_MS,
    );
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}
