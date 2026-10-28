import { haversineKm, type Point } from '../geo/geo.js';

const CEP_PATTERN = /^(\d{5})-?(\d{3})$/;

export function normalizeCep(input: string): string | null {
  const match = CEP_PATTERN.exec(input);
  return match ? `${match[1]}${match[2]}` : null;
}

export const P90_THRESHOLD_KM = 2;

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

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))] as number;
}

export interface CepAssessment {
  center: Point;
  p90Km: number;
  removed: boolean;
}

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

export interface CepPoint extends Point {
  cep: string;
}

export interface Neighbor {
  cep: string;
  distanceKm: number;
}

export function nearestCeps(origin: Point, ceps: CepPoint[], radiusKm: number): Neighbor[] {
  return ceps
    .map((point) => ({ cep: point.cep, distanceKm: haversineKm(origin, point) }))
    .filter((neighbor) => neighbor.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.cep.localeCompare(b.cep));
}
