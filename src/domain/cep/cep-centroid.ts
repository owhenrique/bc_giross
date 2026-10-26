import { haversineKm, type Ponto } from '../geo/haversine.js';

export const LIMIAR_P90_KM = 2;

export function centroideDeUnicos(pontos: Ponto[]): Ponto {
  const unicos = new Map<string, Ponto>();
  for (const p of pontos) unicos.set(`${p.lat},${p.lon}`, p);
  let lat = 0;
  let lon = 0;
  for (const p of unicos.values()) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / unicos.size, lon: lon / unicos.size };
}

/** Percentil por nearest-rank: menor valor com ao menos `p` dos dados abaixo ou iguais. */
export function percentil(valores: number[], p: number): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const posicao = Math.max(1, Math.ceil(p * ordenados.length));
  return ordenados[posicao - 1] as number;
}

export interface AvaliacaoCep {
  centro: Ponto;
  p90Km: number;
  removido: boolean;
}

/** Centróide dos pontos únicos; p90 das distâncias de todos os endereços (repetidos incluídos). */
export function avaliarCep(pontos: Ponto[]): AvaliacaoCep {
  if (pontos.length === 0) throw new Error('CEP sem pontos');
  const centro = centroideDeUnicos(pontos);
  const p90Km = percentil(
    pontos.map((p) => haversineKm(p, centro)),
    0.9,
  );
  return { centro, p90Km, removido: p90Km > LIMIAR_P90_KM };
}
