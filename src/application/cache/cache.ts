/**
 * Key-value cache port.
 *
 * `get` and `set` never throw: a failure is a miss / no-op, so the cache can
 * never break a request. `deleteByPrefix` does throw, because the seed must
 * know when invalidation failed. `delete` throws for the same reason.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

export const RESULT_KEY_PREFIX = 'result:';
export const ADDRESS_KEY_PREFIX = 'address:';
export const GEOCODE_KEY_PREFIX = 'geocode:';
export const CACHE_KEY_PREFIXES = [RESULT_KEY_PREFIX, ADDRESS_KEY_PREFIX, GEOCODE_KEY_PREFIX];

export function resultKey(radiusKm: number, cep: string): string {
  return `${RESULT_KEY_PREFIX}${radiusKm}:${cep}`;
}

export function addressKey(cep: string): string {
  return `${ADDRESS_KEY_PREFIX}${cep}`;
}

export function geocodeKey(cep: string): string {
  return `${GEOCODE_KEY_PREFIX}${cep}`;
}
