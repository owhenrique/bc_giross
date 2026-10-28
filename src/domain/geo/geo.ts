export interface Point {
  lat: number;
  lon: number;
}

export const EARTH_RADIUS_KM = 6371.0088;

export const toRad = (degrees: number): number => (degrees * Math.PI) / 180;

export function haversineKm(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

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
