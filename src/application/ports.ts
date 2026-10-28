import type { BoundingBox } from '../domain/geo/geo.js';

// --- Cache ---

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

// --- CEP repository ---

export interface StoredCep {
  cep: string;
  uf: string;
  latitude: number;
  longitude: number;
}

export interface CepRepository {
  findByCep(cep: string): Promise<StoredCep | null>;
  findInBox(box: BoundingBox): Promise<StoredCep[]>;
  findLoadedUfs(): Promise<string[]>;
}

// --- CEP address provider ---

export interface CepAddress {
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  uf: string | null;
}

export type AddressLookup =
  { status: 'found'; address: CepAddress } | { status: 'not_found' } | { status: 'unavailable' };

/** Never throws: unavailability is a result, so the use case decides how to degrade. */
export interface CepAddressProvider {
  lookup(cep: string): Promise<AddressLookup>;
}

// --- Geocoder ---

export interface GeocodeQuery {
  street: string;
  city: string;
}

export interface GeocodeCandidate {
  lat: number;
  lon: number;
  city: string | null;
  uf: string | null;
}

/** An empty `candidates` list means the provider found nothing. */
export type GeocodeLookup =
  { status: 'found'; candidates: GeocodeCandidate[] } | { status: 'unavailable' };

/** Never throws: unavailability is a result, so the use case decides how to degrade. */
export interface Geocoder {
  search(query: GeocodeQuery): Promise<GeocodeLookup>;
}
