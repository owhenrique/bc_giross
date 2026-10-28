import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { InMemoryCache } from '../../../tests/fakes/in-memory-cache.js';
import type { CepRepository, StoredCep } from '../../application/cep-repository.js';
import type { AddressLookup } from '../../application/cep-address-provider.js';
import type { GeocodeLookup } from '../../application/geocoder.js';
import { OriginGeocoder } from '../../application/origin-geocoder.js';
import { findNearbyCeps } from '../../application/find-nearby-ceps.js';
import { createApp } from './app.js';

const KM_PER_DEGREE = 111.195;
const ORIGIN = {
  cep: '04551000',
  uf: 'SP',
  latitude: -23.59,
  longitude: -46.68,
};

function cepAt(cep: string, km: number): StoredCep {
  return {
    cep,
    uf: 'SP',
    latitude: ORIGIN.latitude + km / KM_PER_DEGREE,
    longitude: ORIGIN.longitude,
  };
}

function inMemoryRepository(items: StoredCep[]): CepRepository {
  return {
    findLoadedUfs: async () => ['SP'],
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

const ADDRESS = {
  street: 'Av. Teste',
  neighborhood: 'Centro',
  city: 'São Paulo',
  uf: 'SP',
};

function appWith(
  repository: CepRepository,
  lookup: AddressLookup = { status: 'not_found' },
  geocode: GeocodeLookup = { status: 'found', candidates: [] },
) {
  const calls = { count: 0, geocoder: 0 };
  const cache = new InMemoryCache();
  const originGeocoder = new OriginGeocoder(
    {
      search: async () => {
        calls.geocoder += 1;
        return geocode;
      },
    },
    cache,
    { foundTtlSeconds: 60, noMatchTtlSeconds: 60 },
  );
  const provider = {
    lookup: async () => {
      calls.count += 1;
      return lookup;
    },
  };
  const app = createApp({
    findNearbyCeps: findNearbyCeps(repository, provider, originGeocoder, cache, {
      radiusKm: 1,
      resultTtlSeconds: 60,
    }),
    logger: pino({ level: 'silent' }),
    rateLimit: { limit: 1000, windowMs: 60_000 },
  });
  return Object.assign(app, { calls });
}

const items = () => [ORIGIN, cepAt('04551010', 0.1234), cepAt('04551020', 0.5)];
const defaultApp = (lookup?: AddressLookup) => appWith(inMemoryRepository(items()), lookup);

const ROUTES = [
  ['simple', (cep: string) => `/ceps-proximos/${cep}`],
  ['detailed', (cep: string) => `/ceps-proximos/${cep}/detalhes`],
] as const;

describe('GET /ceps-proximos/:cep (simple)', () => {
  it('returns the summary without calling the provider', async () => {
    const app = defaultApp({ status: 'found', address: ADDRESS });
    const res = await request(app).get('/ceps-proximos/04551000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      origem: '04551000',
      paginacao: { pagina: 1, limite: 50, total: 2, total_paginas: 1 },
      ceps: [
        { cep: '04551010', distancia_km: 0.12 },
        { cep: '04551020', distancia_km: 0.5 },
      ],
    });
    expect(app.calls.count).toBe(0);
  });
});

describe('result cache', () => {
  it('answers the second call without touching the repository', async () => {
    const repository = inMemoryRepository(items());
    let reads = 0;
    const counting: CepRepository = {
      ...repository,
      findByCep: (cep) => {
        reads += 1;
        return repository.findByCep(cep);
      },
    };
    const app = appWith(counting);
    const first = await request(app).get('/ceps-proximos/04551000');
    const second = await request(app).get('/ceps-proximos/04551000');
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(reads).toBe(1);
  });
});

describe('GET /ceps-proximos/:cep/detalhes', () => {
  it('returns the full contract with the address', async () => {
    const res = await request(defaultApp({ status: 'found', address: ADDRESS })).get(
      '/ceps-proximos/04551000/detalhes',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      origem: {
        cep: '04551000',
        latitude: -23.59,
        longitude: -46.68,
        fonte: 'base',
        endereco: {
          rua: 'Av. Teste',
          bairro: 'Centro',
          cidade: 'São Paulo',
          uf: 'SP',
        },
      },
      raio_km: 1,
      paginacao: { pagina: 1, limite: 50, total: 2, total_paginas: 1 },
      ceps: [
        { cep: '04551010', distancia_km: 0.12 },
        { cep: '04551020', distancia_km: 0.5 },
      ],
    });
  });

  it.each([{ status: 'unavailable' }, { status: 'not_found' }] as const)(
    'returns endereco null when the provider is $status and the cep is in the base',
    async (lookup) => {
      const res = await request(defaultApp(lookup)).get('/ceps-proximos/04551000/detalhes');
      expect(res.status).toBe(200);
      expect(res.body.origem.endereco).toBeNull();
      expect(res.body.ceps).toHaveLength(2);
    },
  );
});

describe.each(ROUTES)('errors and normalization on the %s route', (_name, path) => {
  it('answers the same with or without hyphen', async () => {
    const plain = await request(defaultApp()).get(path('04551000'));
    const hyphen = await request(defaultApp()).get(path('04551-000'));
    expect(hyphen.status).toBe(200);
    expect(hyphen.body).toEqual(plain.body);
  });

  it('returns 404 CEP_NAO_ENCONTRADO when the provider does not know the cep', async () => {
    const res = await request(defaultApp({ status: 'not_found' })).get(path('00000000'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      erro: { codigo: 'CEP_NAO_ENCONTRADO', mensagem: 'CEP não encontrado' },
    });
  });

  it('returns 422 CEP_FORA_DA_COBERTURA when the cep UF is not loaded', async () => {
    const res = await request(
      defaultApp({ status: 'found', address: { ...ADDRESS, uf: 'RJ' } }),
    ).get(path('00000001'));
    expect(res.status).toBe(422);
    expect(res.body.erro.codigo).toBe('CEP_FORA_DA_COBERTURA');
  });

  it('returns 422 CEP_SEM_GEOLOCALIZACAO when the UF is loaded but the cep has no coordinate', async () => {
    const res = await request(defaultApp({ status: 'found', address: ADDRESS })).get(
      path('00000001'),
    );
    expect(res.status).toBe(422);
    expect(res.body.erro.codigo).toBe('CEP_SEM_GEOLOCALIZACAO');
  });

  it('returns 503 PROVEDOR_INDISPONIVEL when the provider is down and the cep is not in the base', async () => {
    const res = await request(defaultApp({ status: 'unavailable' })).get(path('00000001'));
    expect(res.status).toBe(503);
    expect(res.body.erro.codigo).toBe('PROVEDOR_INDISPONIVEL');
  });
});

describe('shared validation and pagination', () => {
  it('returns the contract shape with 2-decimal distances', async () => {
    const res = await request(defaultApp()).get('/ceps-proximos/04551000/detalhes');
    expect(res.status).toBe(200);
    expect(res.body.ceps[0]).toEqual({ cep: '04551010', distancia_km: 0.12 });
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

  it('paginates and returns empty ceps beyond the last page', async () => {
    const neighbors = Array.from({ length: 3 }, (_, i) =>
      cepAt(`04551${i + 1}00`.padEnd(8, '0'), 0.1 * (i + 1)),
    );
    const app = appWith(inMemoryRepository([ORIGIN, ...neighbors]));
    const second = await request(app).get('/ceps-proximos/04551000?pagina=2&limite=2');
    expect(second.body.paginacao).toEqual({
      pagina: 2,
      limite: 2,
      total: 3,
      total_paginas: 2,
    });
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
      expect(res.body).toEqual({
        erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado' },
      });
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
      findLoadedUfs: async () => [],
    };
    const res = await request(appWith(failing)).get('/ceps-proximos/04551000');
    expect(res.status).toBe(500);
    expect(res.body.erro.codigo).toBe('ERRO_INTERNO');
    expect(res.text).not.toMatch(/db down|stack|\.ts/);
  });

  it('maps any 4xx error raised by the stack to 400 PARAMETRO_INVALIDO', async () => {
    const tooLarge: CepRepository = {
      findByCep: async () => {
        throw Object.assign(new Error('payload too large'), { status: 413 });
      },
      findInBox: async () => [],
      findLoadedUfs: async () => [],
    };
    const res = await request(appWith(tooLarge)).get('/ceps-proximos/04551000');
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('PARAMETRO_INVALIDO');
    expect(res.text).not.toMatch(/payload too large/);
  });
});

describe('Nominatim fallback', () => {
  const hit: GeocodeLookup = {
    status: 'found',
    candidates: [{ lat: ORIGIN.latitude, lon: ORIGIN.longitude, city: 'São Paulo', uf: 'SP' }],
  };
  const fallbackApp = (geocode: GeocodeLookup) =>
    appWith(inMemoryRepository(items()), { status: 'found', address: ADDRESS }, geocode);

  it('returns fonte nominatim in the detailed route', async () => {
    const app = fallbackApp(hit);
    const res = await request(app).get('/ceps-proximos/01001000/detalhes');
    expect(res.status).toBe(200);
    expect(res.body.origem).toMatchObject({
      cep: '01001000',
      latitude: ORIGIN.latitude,
      longitude: ORIGIN.longitude,
      fonte: 'nominatim',
    });
    expect(res.body.ceps).toHaveLength(3);
    const again = await request(app).get('/ceps-proximos/01001000/detalhes');
    expect(again.body.origem.fonte).toBe('nominatim');
    expect(app.calls.geocoder).toBe(1);
  });

  it('answers the summary route with the same neighbors', async () => {
    const res = await request(fallbackApp(hit)).get('/ceps-proximos/01001000');
    expect(res.status).toBe(200);
    expect(res.body.ceps).toHaveLength(3);
  });

  it.each(ROUTES)('returns 422 on no match (%s)', async (_name, path) => {
    const res = await request(fallbackApp({ status: 'found', candidates: [] })).get(
      path('01001000'),
    );
    expect(res.status).toBe(422);
    expect(res.body.erro.codigo).toBe('CEP_SEM_GEOLOCALIZACAO');
  });

  it.each(ROUTES)('returns 503 when the geocoder is unavailable (%s)', async (_name, path) => {
    const res = await request(fallbackApp({ status: 'unavailable' })).get(path('01001000'));
    expect(res.status).toBe(503);
    expect(res.body.erro.codigo).toBe('PROVEDOR_INDISPONIVEL');
  });
});
