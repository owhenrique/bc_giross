import { describe, expect, it } from 'vitest';
import { boundingBox } from './bounding-box.js';
import { EARTH_RADIUS_KM, haversineKm, type Point } from './haversine.js';

const KM_PER_DEGREE = (EARTH_RADIUS_KM * Math.PI) / 180;
const center: Point = { lat: -23.55, lon: -46.63 };

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
