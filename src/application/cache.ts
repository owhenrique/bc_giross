/**
 * Key-value cache port.
 *
 * `get` and `set` never throw: a failure is a miss / no-op, so the cache can
 * never break a request. `deleteByPrefix` does throw, because the seed must
 * know when invalidation failed.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}

export const RESULT_KEY_PREFIX = 'result:';

export function resultKey(radiusKm: number, cep: string): string {
  return `${RESULT_KEY_PREFIX}${radiusKm}:${cep}`;
}

export function addressKey(cep: string): string {
  return `address:${cep}`;
}
