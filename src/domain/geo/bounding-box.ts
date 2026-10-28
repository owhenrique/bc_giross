import { EARTH_RADIUS_KM, toRad, type Point } from './haversine.js';

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const KM_PER_DEGREE = EARTH_RADIUS_KM * toRad(1);

/** Box that contains the circle of radiusKm around center. */
export function boundingBox(center: Point, radiusKm: number): BoundingBox {
  const dLat = radiusKm / KM_PER_DEGREE;
  const dLon = dLat / Math.cos(toRad(center.lat));
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLon: center.lon - dLon,
    maxLon: center.lon + dLon,
  };
}
