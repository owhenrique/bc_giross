import { normalizeCep } from '../domain/cep/cep-code.js';
import { boundingBox } from '../domain/geo/bounding-box.js';
import { haversineKm } from '../domain/geo/haversine.js';
import type { CepRepository } from './cep-repository.js';
import { CepNotFoundError, InvalidCepError, InvalidLimitError, InvalidPageError } from './errors.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface FindNearbyCepsInput {
  cep: string;
  page?: number;
  limit?: number;
}

const isIntegerAtLeast = (value: number, min: number) => Number.isInteger(value) && value >= min;

export interface NearbyCepsResult {
  origin: { cep: string; lat: number; lon: number; source: 'dataset' };
  radiusKm: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  neighbors: { cep: string; distanceKm: number }[];
}

export function findNearbyCeps(repository: CepRepository, radiusKm: number) {
  return async (input: FindNearbyCepsInput): Promise<NearbyCepsResult> => {
    const { page = 1, limit = DEFAULT_LIMIT } = input;
    const cep = normalizeCep(input.cep);
    if (!cep) throw new InvalidCepError();
    if (!isIntegerAtLeast(page, 1)) throw new InvalidPageError();
    if (!isIntegerAtLeast(limit, 1) || limit > MAX_LIMIT) throw new InvalidLimitError();

    const stored = await repository.findByCep(cep);
    if (!stored) throw new CepNotFoundError();

    const origin = { lat: stored.latitude, lon: stored.longitude };
    const candidates = await repository.findInBox(boundingBox(origin, radiusKm));
    const all = candidates
      .filter((candidate) => candidate.cep !== stored.cep)
      .map((candidate) => ({
        cep: candidate.cep,
        distanceKm: haversineKm(origin, { lat: candidate.latitude, lon: candidate.longitude }),
      }))
      .filter((neighbor) => neighbor.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm || a.cep.localeCompare(b.cep));

    const total = all.length;
    return {
      origin: { cep: stored.cep, ...origin, source: 'dataset' },
      radiusKm,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      neighbors: all.slice((page - 1) * limit, page * limit),
    };
  };
}
