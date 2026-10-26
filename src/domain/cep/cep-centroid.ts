import { haversineKm, type Point } from '../geo/haversine.js';

export const P90_THRESHOLD_KM = 2;

/** A building with many addresses shares one coordinate; it counts once. */
export function uniquePoints(points: Point[]): Point[] {
  const unique = new Map<string, Point>();
  for (const p of points) unique.set(`${p.lat},${p.lon}`, p);
  return [...unique.values()];
}

export function uniquePointsCentroid(points: Point[]): Point {
  const unique = uniquePoints(points);
  let lat = 0;
  let lon = 0;
  for (const p of unique) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / unique.length, lon: lon / unique.length };
}

/** Lower-index percentile: the value at index floor(p * (n - 1)) of the sorted data. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))] as number;
}

export interface CepAssessment {
  center: Point;
  p90Km: number;
  removed: boolean;
}

/** Centroid and p90 both over the unique points: the spread is geographic, not per household. */
export function assessCep(points: Point[]): CepAssessment {
  if (points.length === 0) throw new Error('CEP without points');
  const unique = uniquePoints(points);
  const center = uniquePointsCentroid(unique);
  const p90Km = percentile(
    unique.map((p) => haversineKm(p, center)),
    0.9,
  );
  return { center, p90Km, removed: p90Km > P90_THRESHOLD_KM };
}
