import { boundingBox } from '../domain/geo/bounding-box.js';
import { haversineKm } from '../domain/geo/haversine.js';
import type { CepRepository } from './cep-repository.js';

export interface FindNearbyCepsInput {
  cep: string;
  page: number;
  limit: number;
}

export type NearbyCepsResult =
  | { status: 'not_found' }
  | {
      status: 'found';
      origin: { cep: string; lat: number; lon: number; source: 'dataset' };
      radiusKm: number;
      pagination: { page: number; limit: number; total: number; totalPages: number };
      neighbors: { cep: string; distanceKm: number }[];
    };

export function findNearbyCeps(repository: CepRepository, radiusKm: number) {
  return async ({ cep, page, limit }: FindNearbyCepsInput): Promise<NearbyCepsResult> => {
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
