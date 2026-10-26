export interface Ponto {
  lat: number;
  lon: number;
}

const RAIO_TERRA_KM = 6371.0088;

const toRad = (graus: number): number => (graus * Math.PI) / 180;

export function haversineKm(a: Ponto, b: Ponto): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
