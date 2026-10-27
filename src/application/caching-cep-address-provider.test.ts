import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '../infrastructure/cache/in-memory-cache.js';
import { CachingCepAddressProvider } from './caching-cep-address-provider.js';
import type { AddressLookup, CepAddressProvider } from './cep-address-provider.js';

const options = { foundTtlSeconds: 1000, notFoundTtlSeconds: 100 };
const found: AddressLookup = {
  status: 'found',
  address: { street: 'Rua A', neighborhood: 'Centro', city: 'Sao Paulo', uf: 'SP' },
};

function setup(results: AddressLookup[]) {
  let now = 0;
  const calls: string[] = [];
  const inner: CepAddressProvider = {
    async lookup(cep) {
      calls.push(cep);
      return results[Math.min(calls.length, results.length) - 1]!;
    },
  };
  const cache = new InMemoryCache(() => now);
  const provider = new CachingCepAddressProvider(inner, cache, options);
  return { provider, calls, advance: (seconds: number) => (now += seconds * 1000) };
}

describe('CachingCepAddressProvider', () => {
  it('returns the cached found lookup without calling the inner provider', async () => {
    const { provider, calls } = setup([found]);
    expect(await provider.lookup('01001000')).toEqual(found);
    expect(await provider.lookup('01001000')).toEqual(found);
    expect(calls).toHaveLength(1);
  });

  it('keeps found for the found TTL', async () => {
    const { provider, calls, advance } = setup([found]);
    await provider.lookup('01001000');
    advance(999);
    await provider.lookup('01001000');
    expect(calls).toHaveLength(1);
    advance(1);
    await provider.lookup('01001000');
    expect(calls).toHaveLength(2);
  });

  it('keeps not_found for the not_found TTL', async () => {
    const { provider, calls, advance } = setup([{ status: 'not_found' }]);
    await provider.lookup('01001000');
    advance(99);
    await provider.lookup('01001000');
    expect(calls).toHaveLength(1);
    advance(1);
    await provider.lookup('01001000');
    expect(calls).toHaveLength(2);
  });

  it('does not cache unavailable, so the next call hits the inner provider again', async () => {
    const { provider, calls } = setup([{ status: 'unavailable' }, found]);
    expect(await provider.lookup('01001000')).toEqual({ status: 'unavailable' });
    expect(await provider.lookup('01001000')).toEqual(found);
    expect(calls).toHaveLength(2);
  });
});
