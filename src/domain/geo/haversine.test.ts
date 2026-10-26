import { describe, expect, it } from 'vitest';
import { haversineKm } from './haversine.js';

describe('haversineKm', () => {
  it('pontos iguais = 0', () => {
    expect(haversineKm({ lat: -23.55, lon: -46.63 }, { lat: -23.55, lon: -46.63 })).toBe(0);
  });

  it('Praça da Sé → Av. Paulista ≈ 2,6 km', () => {
    const se = { lat: -23.5503, lon: -46.6339 };
    const paulista = { lat: -23.5614, lon: -46.6559 };
    expect(haversineKm(se, paulista)).toBeCloseTo(2.6, 0);
  });

  it('São Paulo → Rio ≈ 358 km', () => {
    const sp = { lat: -23.5505, lon: -46.6333 };
    const rio = { lat: -22.9068, lon: -43.1729 };
    expect(haversineKm(sp, rio)).toBeGreaterThan(355);
    expect(haversineKm(sp, rio)).toBeLessThan(361);
  });

  it('antípodas ≈ 20.015 km', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(20015, -1);
  });

  it('é simétrica', () => {
    const a = { lat: -10, lon: -50 };
    const b = { lat: -20, lon: -40 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});
