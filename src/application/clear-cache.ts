import { normalizeCep } from '../domain/cep/cep-code.js';
import { CACHE_KEY_PREFIXES, addressKey, geocodeKey, resultKey, type Cache } from './ports.js';
import { CacheUnavailableError, InvalidCepError } from './errors.js';

export interface ClearCacheOptions {
  radiusKm: number;
}

/**
 * Manual cache invalidation. Any cache failure becomes `CacheUnavailableError`.
 * A failure midway through `all` leaves part of the cache cleared; repeating the call is safe.
 */
export function clearCache(cache: Cache, options: ClearCacheOptions) {
  async function guarded(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (cause) {
      throw new CacheUnavailableError('Cache unavailable', { cause });
    }
  }

  return {
    async all(): Promise<void> {
      await guarded(async () => {
        for (const prefix of CACHE_KEY_PREFIXES) {
          await cache.deleteByPrefix(prefix);
        }
      });
    },

    async cep(input: string): Promise<void> {
      const cep = normalizeCep(input);
      if (!cep) throw new InvalidCepError();
      await guarded(() =>
        cache.delete([addressKey(cep), geocodeKey(cep), resultKey(options.radiusKm, cep)]),
      );
    },
  };
}
