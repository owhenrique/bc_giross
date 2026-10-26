import { haversineKm, type Point } from '../geo/haversine.js';

export const P90_THRESHOLD_KM = 2;

export function uniquePointsCentroid(points: Point[]): Point {
  const unique = new Map<string, Point>();
  for (const p of points) unique.set(`${p.lat},${p.lon}`, p);
  let lat = 0;
  let lon = 0;
  for (const p of unique.values()) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / unique.size, lon: lon / unique.size };
}

/** Nearest-rank percentile: smallest value with at least `p` of the data at or below it. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] as number;
}

export interface CepAssessment {
  center: Point;
  p90Km: number;
  removed: boolean;
}

/** Centroid of the unique points; p90 of the distances of every address (repeats included). */
export function assessCep(points: Point[]): CepAssessment {
  if (points.length === 0) throw new Error('CEP without points');
  const center = uniquePointsCentroid(points);
  const p90Km = percentile(
    points.map((p) => haversineKm(p, center)),
    0.9,
  );
  return { center, p90Km, removed: p90Km > P90_THRESHOLD_KM };
}
