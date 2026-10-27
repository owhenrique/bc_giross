import { addressKey, type Cache } from './cache.js';
import type { AddressLookup, CepAddressProvider } from './cep-address-provider.js';

export interface AddressCacheOptions {
  foundTtlSeconds: number;
  notFoundTtlSeconds: number;
}

/** Caches `found` and `not_found` lookups; `unavailable` is transient and never stored. */
export class CachingCepAddressProvider implements CepAddressProvider {
  constructor(
    private readonly inner: CepAddressProvider,
    private readonly cache: Cache,
    private readonly options: AddressCacheOptions,
  ) {}

  async lookup(cep: string): Promise<AddressLookup> {
    const key = addressKey(cep);
    const cached = await this.cache.get<AddressLookup>(key);
    if (cached) return cached;

    const result = await this.inner.lookup(cep);
    if (result.status === 'found') {
      await this.cache.set(key, result, this.options.foundTtlSeconds);
    } else if (result.status === 'not_found') {
      await this.cache.set(key, result, this.options.notFoundTtlSeconds);
    }
    return result;
  }
}
