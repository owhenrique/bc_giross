import { describe, expect, it } from 'vitest';
import { assessCep, centroid, nearestCeps, normalizeCep, percentile } from './cep.js';

describe('normalizeCep', () => {
  it('keeps an 8-digit cep', () => {
    expect(normalizeCep('04551000')).toBe('04551000');
  });

  it('strips the hyphen', () => {
    expect(normalizeCep('04551-000')).toBe('04551000');
  });

  it.each(['123', '0455100a', '04551-0000', ''])('rejects %j', (input) => {
    expect(normalizeCep(input)).toBeNull();
  });
});

describe('centroid', () => {
  it('is the plain average, counting repeated points', () => {
    const c = centroid([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 },
      { lat: 4, lon: 8 },
    ]);
    expect(c).toEqual({ lat: 1, lon: 2 });
  });

  it('a single point returns itself', () => {
    expect(centroid([{ lat: -9.97, lon: -67.8 }])).toEqual({ lat: -9.97, lon: -67.8 });
  });
});

describe('percentile (index floor(p * (n - 1)))', () => {
  it('p90 of 10 values is the 9th', () => {
    expect(percentile([10, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0.9)).toBe(9);
  });

  it('p90 of 5 values is the 4th, not the largest', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.9)).toBe(4);
  });

  it('single value', () => {
    expect(percentile([5], 0.9)).toBe(5);
  });

  it('two values: index floor(0.9) is the smaller', () => {
    expect(percentile([7, 3], 0.9)).toBe(3);
  });
});

describe('assessCep', () => {
  it('centers on the unique points: repeated points count once', () => {
    const r = assessCep([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 },
      { lat: 2, lon: 4 },
    ]);
    expect(r.center).toEqual({ lat: 1, lon: 2 });
  });

  it('one point: p90 = 0 and it stays', () => {
    const r = assessCep([{ lat: -23.55, lon: -46.63 }]);
    expect(r.p90Km).toBe(0);
    expect(r.removed).toBe(false);
  });

  it('a distant tower with 300 addresses does not remove a compact street', () => {
    const houses = Array.from({ length: 20 }, (_, i) => ({ lat: 0, lon: i * 0.0001 }));
    const tower = Array.from({ length: 300 }, () => ({ lat: 0, lon: 0.03 }));
    const r = assessCep([...houses, ...tower]);
    expect(r.p90Km).toBeLessThan(1);
    expect(r.removed).toBe(false);
  });

  it('a central tower with 300 addresses does not hide a spread CEP', () => {
    const spread = Array.from({ length: 10 }, (_, i) => ({ lat: 0, lon: (i - 4.5) * 0.01 }));
    const tower = Array.from({ length: 300 }, () => ({ lat: 0, lon: 0 }));
    const r = assessCep([...spread, ...tower]);
    expect(r.p90Km).toBeGreaterThan(2);
    expect(r.removed).toBe(true);
  });

  it('small spread stays', () => {
    const r = assessCep([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
    ]);
    expect(r.p90Km).toBeLessThan(2);
    expect(r.removed).toBe(false);
  });

  it('at the threshold: just under 2 km stays, just over is removed', () => {
    const degree = 360 / (2 * Math.PI * 6371.0088);
    const at = (km: number) =>
      assessCep([
        { lat: 0, lon: 0 },
        { lat: 0, lon: 2 * km * degree },
      ]);
    expect(at(1.9999).removed).toBe(false);
    expect(at(2.0001).removed).toBe(true);
  });

  it('throws on an empty list', () => {
    expect(() => assessCep([])).toThrow();
  });
});

describe('nearestCeps', () => {
  const origin = { lat: 0, lon: 0 };
  const at = (cep: string, lon: number) => ({ cep, lat: 0, lon });

  it('keeps only the CEPs within the radius', () => {
    const result = nearestCeps(origin, [at('00000001', 0.01), at('00000002', 0.05)], 2);
    expect(result.map((n) => n.cep)).toEqual(['00000001']);
  });

  it('orders by distance, nearest first, with the distance in km', () => {
    const result = nearestCeps(origin, [at('00000002', 0.015), at('00000001', 0.005)], 5);
    expect(result.map((n) => n.cep)).toEqual(['00000001', '00000002']);
    expect(result[0]?.distanceKm).toBeCloseTo(0.556, 2);
  });

  it('breaks distance ties by CEP', () => {
    const result = nearestCeps(origin, [at('00000009', 0.01), at('00000003', -0.01)], 5);
    expect(result.map((n) => n.cep)).toEqual(['00000003', '00000009']);
  });

  it('keeps a CEP exactly on the radius', () => {
    const point = at('00000001', 0.01);
    const radius = nearestCeps(origin, [point], 100)[0]?.distanceKm as number;
    expect(nearestCeps(origin, [point], radius)).toHaveLength(1);
  });

  it('returns an empty list when there are no CEPs', () => {
    expect(nearestCeps(origin, [], 5)).toEqual([]);
  });
});
