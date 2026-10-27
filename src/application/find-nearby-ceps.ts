import { normalizeCep } from '../domain/cep/cep-code.js';
import { boundingBox } from '../domain/geo/bounding-box.js';
import { haversineKm } from '../domain/geo/haversine.js';
import type { CepRepository } from './cep-repository.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface FindNearbyCepsInput {
  cep: string;
  page?: number;
  limit?: number;
}

const isIntegerAtLeast = (value: number, min: number) => Number.isInteger(value) && value >= min;

export type NearbyCepsResult =
  | { status: 'invalid_cep' }
  | { status: 'invalid_pagination'; field: 'page' | 'limit' }
  | { status: 'not_found' }
  | {
      status: 'found';
      origin: { cep: string; lat: number; lon: number; source: 'dataset' };
      radiusKm: number;
      pagination: { page: number; limit: number; total: number; totalPages: number };
      neighbors: { cep: string; distanceKm: number }[];
    };

export function findNearbyCeps(repository: CepRepository, radiusKm: number) {
  return async (input: FindNearbyCepsInput): Promise<NearbyCepsResult> => {
    const { page = 1, limit = DEFAULT_LIMIT } = input;
    const cep = normalizeCep(input.cep);
    if (!cep) return { status: 'invalid_cep' };
    if (!isIntegerAtLeast(page, 1)) return { status: 'invalid_pagination', field: 'page' };
    if (!isIntegerAtLeast(limit, 1) || limit > MAX_LIMIT) return { status: 'invalid_pagination', field: 'limit' };

    const stored = await repository.findByCep(cep);
    if (!stored) return { status: 'not_found' };

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
      status: 'found',
      origin: { cep: stored.cep, ...origin, source: 'dataset' },
      radiusKm,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      neighbors: all.slice((page - 1) * limit, page * limit),
    };
  };
}
