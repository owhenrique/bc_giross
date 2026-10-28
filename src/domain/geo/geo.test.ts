import { describe, expect, it } from 'vitest';
import { boundingBox, EARTH_RADIUS_KM, haversineKm, type Point } from './geo.js';

const KM_PER_DEGREE = (EARTH_RADIUS_KM * Math.PI) / 180;
const center: Point = { lat: -23.55, lon: -46.63 };

describe('haversineKm', () => {
  it('identical points = 0', () => {
    expect(haversineKm({ lat: -23.55, lon: -46.63 }, { lat: -23.55, lon: -46.63 })).toBe(0);
  });

  it('Praça da Sé to Av. Paulista is about 2.6 km', () => {
    const se = { lat: -23.5503, lon: -46.6339 };
    const paulista = { lat: -23.5614, lon: -46.6559 };
    expect(haversineKm(se, paulista)).toBeCloseTo(2.6, 0);
  });

  it('São Paulo to Rio is about 358 km', () => {
    const sp = { lat: -23.5505, lon: -46.6333 };
    const rio = { lat: -22.9068, lon: -43.1729 };
    expect(haversineKm(sp, rio)).toBeGreaterThan(355);
    expect(haversineKm(sp, rio)).toBeLessThan(361);
  });

  it('antipodes are about 20,015 km', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(20015, -1);
  });

  it('is symmetric', () => {
    const a = { lat: -10, lon: -50 };
    const b = { lat: -20, lon: -40 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});

describe('boundingBox', () => {
  it('contains points radiusKm away to the north, south, east and west', () => {
    const radiusKm = 1;
    const box = boundingBox(center, radiusKm);
    const dLat = radiusKm / KM_PER_DEGREE;
    const dLon = dLat / Math.cos((center.lat * Math.PI) / 180);
    const points: Point[] = [
      { lat: center.lat + dLat, lon: center.lon },
      { lat: center.lat - dLat, lon: center.lon },
      { lat: center.lat, lon: center.lon + dLon },
      { lat: center.lat, lon: center.lon - dLon },
    ];
    for (const p of points) {
      expect(haversineKm(center, p)).toBeLessThanOrEqual(radiusKm + 1e-9);
      expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(p.lat).toBeLessThanOrEqual(box.maxLat);
      expect(p.lon).toBeGreaterThanOrEqual(box.minLon);
      expect(p.lon).toBeLessThanOrEqual(box.maxLon);
    }
  });

  it('is symmetric around the center at the equator', () => {
    const box = boundingBox({ lat: 0, lon: 10 }, 5);
    expect(box.maxLat).toBeCloseTo(-box.minLat, 10);
    expect(box.maxLon - 10).toBeCloseTo(10 - box.minLon, 10);
    expect(box.maxLon - 10).toBeCloseTo(box.maxLat, 10);
  });
});
