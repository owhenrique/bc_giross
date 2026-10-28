import { geocodeKey, type Cache } from '../cache/cache.js';
import type { CepAddress } from './cep-address-provider.js';
import type { Geocoder } from './geocoder.js';

export type OriginLocation =
  | { status: 'found'; lat: number; lon: number }
  | { status: 'no_match' }
  | { status: 'unavailable' };

export interface OriginGeocoderOptions {
  foundTtlSeconds: number;
  noMatchTtlSeconds: number;
}

const sameName = (a: string | null, b: string) =>
  a !== null && normalizeName(a) === normalizeName(b);

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export class OriginGeocoder {
  constructor(
    private readonly geocoder: Geocoder,
    private readonly cache: Cache,
    private readonly options: OriginGeocoderOptions,
  ) {}

  async locate(cep: string, address: CepAddress): Promise<OriginLocation> {
    const { street, city, uf } = address;
    if (!street || !city || !uf) return { status: 'no_match' };

    const key = geocodeKey(cep);
    const cached = await this.cache.get<OriginLocation>(key);
    if (cached) return cached;

    const lookup = await this.geocoder.search({ street, city });
    if (lookup.status === 'unavailable') return lookup;

    const match = lookup.candidates.find(
      (candidate) => sameName(candidate.city, city) && candidate.uf === uf,
    );
    const location: OriginLocation = match
      ? { status: 'found', lat: match.lat, lon: match.lon }
      : { status: 'no_match' };
    const ttl = match ? this.options.foundTtlSeconds : this.options.noMatchTtlSeconds;
    await this.cache.set(key, location, ttl);
    return location;
  }
}
