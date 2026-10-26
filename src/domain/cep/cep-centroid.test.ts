import { describe, expect, it } from 'vitest';
import { avaliarCep, centroideDeUnicos, percentil } from './cep-centroid.js';

describe('centroideDeUnicos', () => {
  it('ignora pontos repetidos na média', () => {
    const c = centroideDeUnicos([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 },
      { lat: 2, lon: 4 },
    ]);
    expect(c).toEqual({ lat: 1, lon: 2 });
  });

  it('um ponto só devolve ele mesmo', () => {
    expect(centroideDeUnicos([{ lat: -9.97, lon: -67.8 }])).toEqual({ lat: -9.97, lon: -67.8 });
  });
});

describe('percentil (nearest-rank)', () => {
  it('p90 de 10 valores é o 9º', () => {
    expect(percentil([10, 1, 2, 3, 4, 5, 6, 7, 8, 9], 0.9)).toBe(9);
  });

  it('um valor só', () => {
    expect(percentil([5], 0.9)).toBe(5);
  });
});

describe('avaliarCep', () => {
  it('um ponto: p90 = 0 e permanece', () => {
    const r = avaliarCep([{ lat: -23.55, lon: -46.63 }]);
    expect(r.p90Km).toBe(0);
    expect(r.removido).toBe(false);
  });

  it('repetidos pesam no p90: 1 ponto distante entre muitos repetidos', () => {
    const perto = Array.from({ length: 19 }, () => ({ lat: 0, lon: 0 }));
    const r = avaliarCep([...perto, { lat: 0, lon: 0.5 }]);
    // centróide dos únicos = (0, 0.25); todos a ~27,8 km do centro
    expect(r.p90Km).toBeGreaterThan(20);
    expect(r.removido).toBe(true);
  });

  it('espalhamento pequeno permanece', () => {
    const r = avaliarCep([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
    ]);
    expect(r.p90Km).toBeLessThan(2);
    expect(r.removido).toBe(false);
  });

  it('limiar de 2 km: 1,9 km permanece, 2,1 km remove', () => {
    const grau = 360 / (2 * Math.PI * 6371.0088);
    const com = (km: number) => avaliarCep([{ lat: 0, lon: 0 }, { lat: 0, lon: 2 * km * grau }]);
    expect(com(1.9).removido).toBe(false);
    expect(com(2.1).removido).toBe(true);
  });

  it('lança com lista vazia', () => {
    expect(() => avaliarCep([])).toThrow();
  });
});
