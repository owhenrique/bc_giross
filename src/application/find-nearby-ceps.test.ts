import { describe, expect, it } from 'vitest';
import type { CepRepository, StoredCep } from './cep-repository.js';
import { findNearbyCeps, type NearbyCepsResult } from './find-nearby-ceps.js';

const KM_PER_DEGREE = 111.195;
const ORIGIN = { cep: '04551000', uf: 'SP', latitude: -23.59, longitude: -46.68 };

function cepAt(cep: string, km: number): StoredCep {
  return { cep, uf: 'SP', latitude: ORIGIN.latitude + km / KM_PER_DEGREE, longitude: ORIGIN.longitude };
}

function inMemoryRepository(items: StoredCep[]): CepRepository {
  return {
    findByCep: async (cep) => items.find((item) => item.cep === cep) ?? null,
    findInBox: async (box) =>
      items.filter(
        (item) =>
          item.latitude >= box.minLat &&
          item.latitude <= box.maxLat &&
          item.longitude >= box.minLon &&
          item.longitude <= box.maxLon,
      ),
  };
}

function search(items: StoredCep[], page = 1, limit = 50, radiusKm = 1): Promise<NearbyCepsResult> {
  return findNearbyCeps(inMemoryRepository([ORIGIN, ...items]), radiusKm)({ cep: ORIGIN.cep, page, limit });
}

function found(result: NearbyCepsResult) {
  if (result.status !== 'found') throw new Error('expected found');
  return result;
}

describe('findNearbyCeps', () => {
  it('returns not_found when the origin is not in the repository', async () => {
    const result = await findNearbyCeps(inMemoryRepository([]), 1)({ cep: '99999999', page: 1, limit: 50 });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('returns the origin from the dataset without including it as neighbor', async () => {
    const result = found(await search([cepAt('04551010', 0.5)]));
    expect(result.origin).toEqual({ cep: ORIGIN.cep, lat: ORIGIN.latitude, lon: ORIGIN.longitude, source: 'dataset' });
    expect(result.radiusKm).toBe(1);
    expect(result.neighbors.map((n) => n.cep)).toEqual(['04551010']);
  });

  it('excludes a cep 1.004 km away when radius is 1 km', async () => {
    const result = found(await search([cepAt('04551020', 1.004)]));
    expect(result.neighbors).toEqual([]);
  });

  it('includes a cep 0.999 km away when radius is 1 km', async () => {
    const result = found(await search([cepAt('04551020', 0.999)]));
    expect(result.neighbors).toHaveLength(1);
    expect(result.neighbors[0]?.distanceKm).toBeLessThanOrEqual(1);
  });

  it('sorts by distance and breaks ties by cep', async () => {
    const result = found(
      await search([cepAt('04551050', 0.8), cepAt('04551030', 0.3), cepAt('04551040', 0.3), cepAt('04551020', 0.1)]),
    );
    expect(result.neighbors.map((n) => n.cep)).toEqual(['04551020', '04551030', '04551040', '04551050']);
  });

  describe('pagination', () => {
    const items = Array.from({ length: 5 }, (_, i) => cepAt(`0455100${i + 1}`, 0.1 * (i + 1)));

    it('reports total and totalPages', async () => {
      const result = found(await search(items, 1, 2));
      expect(result.pagination).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
      expect(result.neighbors.map((n) => n.cep)).toEqual(['04551001', '04551002']);
    });

    it('returns the second page', async () => {
      const result = found(await search(items, 2, 2));
      expect(result.neighbors.map((n) => n.cep)).toEqual(['04551003', '04551004']);
    });

    it('returns an empty page beyond the last one', async () => {
      const result = found(await search(items, 4, 2));
      expect(result.neighbors).toEqual([]);
      expect(result.pagination.total).toBe(5);
    });

    it('returns totalPages 0 when there are no neighbors', async () => {
      const result = found(await search([]));
      expect(result.pagination).toEqual({ page: 1, limit: 50, total: 0, totalPages: 0 });
    });
  });
});
