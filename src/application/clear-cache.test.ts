import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '../infrastructure/cache/in-memory-cache.js';
import { addressKey, geocodeKey, resultKey, type Cache } from './cache.js';
import { clearCache } from './clear-cache.js';
import { CacheUnavailableError, InvalidCepError } from './errors.js';

const RADIUS_KM = 10;

async function seed(cache: Cache, cep: string) {
  await cache.set(addressKey(cep), 1, 100);
  await cache.set(geocodeKey(cep), 1, 100);
  await cache.set(resultKey(RADIUS_KM, cep), 1, 100);
}

async function present(cache: Cache, keys: string[]) {
  return Promise.all(keys.map(async (key) => (await cache.get(key)) !== null));
}

function failingCache(error: Error): Cache {
  return {
    get: async () => null,
    set: async () => {},
    deleteByPrefix: async () => {
      throw error;
    },
    delete: async () => {
      throw error;
    },
  };
}

describe('clearCache', () => {
  it('all removes the three app prefixes and keeps foreign keys', async () => {
    const cache = new InMemoryCache();
    await seed(cache, '04551000');
    await cache.set('outra:chave', 1, 100);

    await clearCache(cache, { radiusKm: RADIUS_KM }).all();

    expect(
      await present(cache, [
        addressKey('04551000'),
        geocodeKey('04551000'),
        resultKey(RADIUS_KM, '04551000'),
        'outra:chave',
      ]),
    ).toEqual([false, false, false, true]);
  });

  it('cep removes the three keys of that CEP and keeps other CEPs', async () => {
    const cache = new InMemoryCache();
    await seed(cache, '04551000');
    await seed(cache, '01001000');

    await clearCache(cache, { radiusKm: RADIUS_KM }).cep('04551000');

    expect(
      await present(cache, [
        addressKey('04551000'),
        geocodeKey('04551000'),
        resultKey(RADIUS_KM, '04551000'),
        addressKey('01001000'),
        geocodeKey('01001000'),
        resultKey(RADIUS_KM, '01001000'),
      ]),
    ).toEqual([false, false, false, true, true, true]);
  });

  it('cep normalizes a CEP with a hyphen', async () => {
    const cache = new InMemoryCache();
    await seed(cache, '04551000');

    await clearCache(cache, { radiusKm: RADIUS_KM }).cep('04551-000');

    expect(await present(cache, [addressKey('04551000')])).toEqual([false]);
  });

  it('cep rejects an invalid CEP', async () => {
    const clear = clearCache(new InMemoryCache(), { radiusKm: RADIUS_KM });
    await expect(clear.cep('123')).rejects.toBeInstanceOf(InvalidCepError);
  });

  it('is idempotent on an empty cache', async () => {
    const clear = clearCache(new InMemoryCache(), { radiusKm: RADIUS_KM });
    await expect(clear.all()).resolves.toBeUndefined();
    await expect(clear.cep('04551000')).resolves.toBeUndefined();
  });

  it('wraps cache failures in CacheUnavailableError keeping the cause', async () => {
    const original = new Error('redis down');
    const clear = clearCache(failingCache(original), { radiusKm: RADIUS_KM });

    for (const run of [() => clear.all(), () => clear.cep('04551000')]) {
      const error = await run().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CacheUnavailableError);
      expect((error as CacheUnavailableError).cause).toBe(original);
    }
  });
});
