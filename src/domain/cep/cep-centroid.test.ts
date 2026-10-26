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

describe('percentile (nearest-rank)', () => {
  it('p90 of 10 values is the 9th', () => {
    expect(percentile([10, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0.9)).toBe(9);
  });

  it('single value', () => {
    expect(percentile([5], 0.9)).toBe(5);
  });
});

describe('assessCep', () => {
  it('one point: p90 = 0 and it stays', () => {
    const r = assessCep([{ lat: -23.55, lon: -46.63 }]);
    expect(r.p90Km).toBe(0);
    expect(r.removed).toBe(false);
  });

  it('repeats weigh on p90: one distant point among many repeats', () => {
    const near = Array.from({ length: 19 }, () => ({ lat: 0, lon: 0 }));
    const r = assessCep([...near, { lat: 0, lon: 0.5 }]);
    // centroid of the unique points = (0, 0.25); every address is ~27.8 km from it
    expect(r.p90Km).toBeGreaterThan(20);
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

  it('2 km threshold: 1.9 km stays, 2.1 km is removed', () => {
    const degree = 360 / (2 * Math.PI * 6371.0088);
    const at = (km: number) =>
      assessCep([
        { lat: 0, lon: 0 },
        { lat: 0, lon: 2 * km * degree },
      ]);
    expect(at(1.9).removed).toBe(false);
    expect(at(2.1).removed).toBe(true);
  });

  it('throws on an empty list', () => {
    expect(() => assessCep([])).toThrow();
  });
});
