import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { CepRepository, StoredCep } from '../../application/cep-repository.js';
import { findNearbyCeps } from '../../application/find-nearby-ceps.js';
import { createApp } from './app.js';

const KM_PER_DEGREE = 111.195;
const ORIGIN = { cep: '04551000', uf: 'SP', latitude: -23.59, longitude: -46.68 };

function cepAt(cep: string, km: number): StoredCep {
  return { cep, uf: 'SP', latitude: ORIGIN.latitude + km / KM_PER_DEGREE, longitude: ORIGIN.longitude };
}

function inMemoryRepository(items: StoredCep[]): CepRepository {
  return {
    findByCep: async (cep) => items.find((item) => item.cep === cep) ?? null,
    findInBox: async (box) =>
      items.filter(
        (item) =>
          item.latitude >= box.minLat &&
          item.latitude <= box.maxLat &&
          item.longitude >= box.minLon &&
          item.longitude <= box.maxLon,
      ),
  };
}

function appWith(repository: CepRepository) {
  return createApp({ findNearbyCeps: findNearbyCeps(repository, 1), logger: pino({ level: 'silent' }) });
}

const defaultApp = () => appWith(inMemoryRepository([ORIGIN, cepAt('04551010', 0.1234), cepAt('04551020', 0.5)]));

describe('GET /ceps-proximos/:cep', () => {
  it('returns the contract shape with 2-decimal distances', async () => {
    const res = await request(defaultApp()).get('/ceps-proximos/04551000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      origem: { cep: '04551000', latitude: -23.59, longitude: -46.68, fonte: 'base' },
      raio_km: 1,
      paginacao: { pagina: 1, limite: 50, total: 2, total_paginas: 1 },
      ceps: [
        { cep: '04551010', distancia_km: 0.12 },
        { cep: '04551020', distancia_km: 0.5 },
      ],
    });
  });

  it('answers the same with or without hyphen', async () => {
    const plain = await request(defaultApp()).get('/ceps-proximos/04551000');
    const hyphen = await request(defaultApp()).get('/ceps-proximos/04551-000');
    expect(hyphen.status).toBe(200);
    expect(hyphen.body).toEqual(plain.body);
    expect(hyphen.body.origem.cep).toBe('04551000');
  });

  it('returns 400 CEP_INVALIDO for a malformed cep', async () => {
    const res = await request(defaultApp()).get('/ceps-proximos/123');
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('CEP_INVALIDO');
  });

  it.each(['limite=201', 'pagina=0', 'limite=abc', 'pagina=1.5'])(
    'returns 400 PARAMETRO_INVALIDO for ?%s',
    async (query) => {
      const res = await request(defaultApp()).get(`/ceps-proximos/04551000?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.erro.codigo).toBe('PARAMETRO_INVALIDO');
      expect(typeof res.body.erro.mensagem).toBe('string');
    },
  );

  it('returns 404 CEP_NAO_ENCONTRADO for an unknown cep', async () => {
    const res = await request(defaultApp()).get('/ceps-proximos/00000000');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: { codigo: 'CEP_NAO_ENCONTRADO', mensagem: 'CEP não encontrado' } });
  });

  it('paginates and returns empty ceps beyond the last page', async () => {
    const neighbors = Array.from({ length: 3 }, (_, i) => cepAt(`04551${i + 1}00`.padEnd(8, '0'), 0.1 * (i + 1)));
    const app = appWith(inMemoryRepository([ORIGIN, ...neighbors]));
    const second = await request(app).get('/ceps-proximos/04551000?pagina=2&limite=2');
    expect(second.body.paginacao).toEqual({ pagina: 2, limite: 2, total: 3, total_paginas: 2 });
    expect(second.body.ceps).toHaveLength(1);
    const beyond = await request(app).get('/ceps-proximos/04551000?pagina=9&limite=2');
    expect(beyond.status).toBe(200);
    expect(beyond.body.ceps).toEqual([]);
  });
});

describe('unknown routes and unexpected errors', () => {
  it('returns an identical generic 404 for any path or method', async () => {
    const app = defaultApp();
    const responses = await Promise.all([
      request(app).get('/admin'),
      request(app).get('/qualquer/coisa'),
      request(app).post('/ceps-proximos/04551000'),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado' } });
      expect(res.text).not.toMatch(/admin|qualquer|coisa|ceps-proximos/);
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('returns 500 ERRO_INTERNO without stack when the repository throws', async () => {
    const failing: CepRepository = {
      findByCep: async () => {
        throw new Error('db down');
      },
      findInBox: async () => [],
    };
    const res = await request(appWith(failing)).get('/ceps-proximos/04551000');
    expect(res.status).toBe(500);
    expect(res.body.erro.codigo).toBe('ERRO_INTERNO');
    expect(res.text).not.toMatch(/db down|stack|\.ts/);
  });
});
