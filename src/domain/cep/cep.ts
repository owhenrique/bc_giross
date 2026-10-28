import { haversineKm, type Point } from '../geo/geo.js';

const CEP_PATTERN = /^(\d{5})-?(\d{3})$/;

/** Returns the 8-digit CEP, or null when the input is not a valid CEP. */
export function normalizeCep(input: string): string | null {
  const match = CEP_PATTERN.exec(input);
  return match ? `${match[1]}${match[2]}` : null;
}

export const P90_THRESHOLD_KM = 2;

/** A building with many addresses shares one coordinate; it counts once. */
export function uniquePoints(points: Point[]): Point[] {
  const unique = new Map<string, Point>();
  for (const p of points) unique.set(`${p.lat},${p.lon}`, p);
  return [...unique.values()];
}

export function centroid(points: Point[]): Point {
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / points.length, lon: lon / points.length };
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
  const center = centroid(unique);
  const p90Km = percentile(
    unique.map((p) => haversineKm(p, center)),
    0.9,
  );
  return { center, p90Km, removed: p90Km > P90_THRESHOLD_KM };
}
