import { describe, expect, it } from 'vitest';
import {
  CACHE_KEY_PREFIXES,
  addressKey,
  geocodeKey,
  resultKey,
} from '../../src/application/cache.js';
import { InMemoryCache } from './in-memory-cache.js';

describe('InMemoryCache', () => {
  it('returns null on a miss and the value on a hit', async () => {
    const cache = new InMemoryCache();
    expect(await cache.get('a')).toBeNull();
    await cache.set('a', { x: 1 }, 10);
    expect(await cache.get('a')).toEqual({ x: 1 });
  });

  it('expires entries after the TTL using the injected clock', async () => {
    let time = 1000;
    const cache = new InMemoryCache(() => time);
    await cache.set('a', 1, 10);
    time += 9999;
    expect(await cache.get('a')).toBe(1);
    time += 1;
    expect(await cache.get('a')).toBeNull();
  });

  it('deletes only keys with the given prefix', async () => {
    const cache = new InMemoryCache();
    await cache.set('result:1:01001000', 1, 10);
    await cache.set('result:2:01001000', 2, 10);
    await cache.set('address:01001000', 3, 10);
    await cache.deleteByPrefix('result:');
    expect(await cache.get('result:1:01001000')).toBeNull();
    expect(await cache.get('result:2:01001000')).toBeNull();
    expect(await cache.get('address:01001000')).toBe(3);
  });

  it('deletes only the given keys and ignores missing ones', async () => {
    const cache = new InMemoryCache();
    await cache.set('a', 1, 10);
    await cache.set('b', 2, 10);
    await cache.set('c', 3, 10);
    await cache.delete(['a', 'b', 'missing']);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('c')).toBe(3);
  });
});

describe('cache keys', () => {
  it('builds result and address keys', () => {
    expect(resultKey(1.5, '01001000')).toBe('result:1.5:01001000');
    expect(addressKey('01001000')).toBe('address:01001000');
    expect(geocodeKey('01001000')).toBe('geocode:01001000');
    expect(CACHE_KEY_PREFIXES).toEqual(['result:', 'address:', 'geocode:']);
  });
});
