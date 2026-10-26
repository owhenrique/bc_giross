import { describe, expect, it } from 'vitest';
import { assessCep, percentile, uniquePointsCentroid } from './cep-centroid.js';

describe('uniquePointsCentroid', () => {
  it('ignores repeated points in the average', () => {
    const c = uniquePointsCentroid([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 },
      { lat: 2, lon: 4 },
    ]);
    expect(c).toEqual({ lat: 1, lon: 2 });
  });

  it('a single point returns itself', () => {
    expect(uniquePointsCentroid([{ lat: -9.97, lon: -67.8 }])).toEqual({ lat: -9.97, lon: -67.8 });
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
  it('one point: p90 = 0 and it stays', () => {
    const r = assessCep([{ lat: -23.55, lon: -46.63 }]);
    expect(r.p90Km).toBe(0);
    expect(r.removed).toBe(false);
  });

  it('a distant tower with 300 addresses does not remove a compact street', () => {
    const houses = Array.from({ length: 20 }, (_, i) => ({ lat: 0, lon: i * 0.0001 }));
    const tower = Array.from({ length: 300 }, () => ({ lat: 0, lon: 0.03 }));
    const r = assessCep([...houses, ...tower]);
    // 21 unique points: the tower (~3.2 km away) is only the 21st value, past the p90
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
