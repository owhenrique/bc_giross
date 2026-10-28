import { createClient } from 'redis';
import type { Logger } from 'pino';
import type { Cache } from '../../application/cache/cache.js';

export const CACHE_OPERATION_TIMEOUT_MS = 500;
const SCAN_COUNT = 500;

export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string[]>;
  unlink(keys: string[]): Promise<unknown>;
}

export function createRedisClient(url: string, logger: Pick<Logger, 'warn'>, reconnect = true) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    ...(reconnect ? {} : { socket: { reconnectStrategy: false as const } }),
  });
  client.on('error', (error) => logger.warn({ err: error }, 'redis client error'));
  return client;
}

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
    const iterator = this.client
      .scanIterator({ MATCH: `${prefix}*`, COUNT: SCAN_COUNT })
      [Symbol.asyncIterator]();
    try {
      for (let page = await withTimeout(iterator.next()); !page.done;) {
        const keys = page.value;
        if (keys.length > 0) await withTimeout(this.client.unlink(keys));
        page = await withTimeout(iterator.next());
      }
    } finally {
      await iterator.return?.();
    }
  }

  async delete(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await withTimeout(this.client.unlink(keys));
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs = CACHE_OPERATION_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`cache operation timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}
