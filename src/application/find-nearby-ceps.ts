import { normalizeCep } from '../domain/cep/cep-code.js';
import { boundingBox } from '../domain/geo/bounding-box.js';
import { haversineKm } from '../domain/geo/haversine.js';
import { resultKey, type Cache } from './cache.js';
import type { AddressLookup, CepAddress, CepAddressProvider } from './cep-address-provider.js';
import type { CepRepository } from './cep-repository.js';
import type { OriginGeocoder } from './origin-geocoder.js';
import {
  AddressProviderUnavailableError,
  CepNotFoundError,
  CepOutOfCoverageError,
  CepWithoutLocationError,
  InvalidCepError,
  InvalidLimitError,
  InvalidPageError,
} from './errors.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface FindNearbyCepsInput {
  cep: string;
  page?: number;
  limit?: number;
  withAddress?: boolean;
}

const isIntegerAtLeast = (value: number, min: number) => Number.isInteger(value) && value >= min;

export type OriginSource = 'dataset' | 'nominatim';

export interface NearbyCepsResult {
  origin: {
    cep: string;
    lat: number;
    lon: number;
    source: OriginSource;
    address: CepAddress | null;
  };
  radiusKm: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  neighbors: { cep: string; distanceKm: number }[];
}

interface Neighbor {
  cep: string;
  distanceKm: number;
}

interface CachedResult {
  // `source` is absent in results cached before the Nominatim fallback existed; those came from the dataset.
  origin: { cep: string; lat: number; lon: number; source?: OriginSource };
  neighbors: Neighbor[];
}

export interface FindNearbyCepsOptions {
  radiusKm: number;
  resultTtlSeconds: number;
}

export function findNearbyCeps(
  repository: CepRepository,
  addressProvider: CepAddressProvider,
  originGeocoder: OriginGeocoder,
  cache: Cache,
  { radiusKm, resultTtlSeconds }: FindNearbyCepsOptions,
) {
  async function computeResult(
    cep: string,
    lookupPromise: Promise<AddressLookup> | null,
  ): Promise<CachedResult> {
    const stored = await repository.findByCep(cep);
    let origin: { lat: number; lon: number };
    let source: OriginSource = 'dataset';
    if (stored) {
      origin = { lat: stored.latitude, lon: stored.longitude };
    } else {
      const lookup = await (lookupPromise ?? addressProvider.lookup(cep));
      if (lookup.status === 'not_found') throw new CepNotFoundError();
      if (lookup.status === 'unavailable') throw new AddressProviderUnavailableError();
      const loadedUfs = await repository.findLoadedUfs();
      if (lookup.address.uf === null || !loadedUfs.includes(lookup.address.uf)) {
        throw new CepOutOfCoverageError();
      }
      const located = await originGeocoder.locate(cep, lookup.address);
      if (located.status === 'no_match') throw new CepWithoutLocationError();
      if (located.status === 'unavailable') throw new AddressProviderUnavailableError();
      origin = { lat: located.lat, lon: located.lon };
      source = 'nominatim';
    }
    const candidates = await repository.findInBox(boundingBox(origin, radiusKm));
    const neighbors = candidates
      .filter((candidate) => candidate.cep !== cep)
      .map((candidate) => ({
        cep: candidate.cep,
        distanceKm: haversineKm(origin, { lat: candidate.latitude, lon: candidate.longitude }),
      }))
      .filter((neighbor) => neighbor.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm || a.cep.localeCompare(b.cep));

    return { origin: { cep, ...origin, source }, neighbors };
  }

  return async (input: FindNearbyCepsInput): Promise<NearbyCepsResult> => {
    const { page = 1, limit = DEFAULT_LIMIT, withAddress = false } = input;
    const cep = normalizeCep(input.cep);
    if (!cep) throw new InvalidCepError();
    if (!isIntegerAtLeast(page, 1)) throw new InvalidPageError();
    if (!isIntegerAtLeast(limit, 1) || limit > MAX_LIMIT) throw new InvalidLimitError();

    const lookupPromise: Promise<AddressLookup> | null = withAddress
      ? addressProvider.lookup(cep)
      : null;
    // Marks the promise as handled in case findByCep throws first; the awaits below still see any rejection.
    lookupPromise?.catch(() => {});
    const key = resultKey(radiusKm, cep);
    const cached = await cache.get<CachedResult>(key);
    const result = cached ?? (await computeResult(cep, lookupPromise));
    if (!cached) await cache.set(key, result, resultTtlSeconds);
    const originLookup = lookupPromise ? await lookupPromise : null;
    const address = originLookup?.status === 'found' ? originLookup.address : null;

    const all = result.neighbors;
    const total = all.length;
    return {
      origin: { ...result.origin, source: result.origin.source ?? 'dataset', address },
      radiusKm,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      neighbors: all.slice((page - 1) * limit, page * limit),
    };
  };
}
