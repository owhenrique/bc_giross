import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { expectMatchesContract, openApiDocument } from './openapi-contract.js';
import { InMemoryCache } from '../fakes/in-memory-cache.js';
import { clearCache } from '../../src/application/cache/clear-cache.js';
import type { AddressLookup } from '../../src/application/providers/cep-address-provider.js';
import type { GeocodeLookup } from '../../src/application/providers/geocoder.js';
import { OriginGeocoder } from '../../src/application/providers/origin-geocoder.js';
import type { CepRepository, StoredCep } from '../../src/application/use-cases/cep-repository.js';
import { findNearbyCeps } from '../../src/application/use-cases/find-nearby-ceps.js';
import { createApp } from '../../src/presentation/http/app.js';
import { ERROR_CATALOG, HTTP_ERRORS } from '../../src/presentation/http/errors/errors.js';

const TOKEN = 'a-secret-token-123';
const AUTH = `Bearer ${TOKEN}`;
const KM_PER_DEGREE = 111.195;
const ORIGIN: StoredCep = { cep: '04551000', uf: 'SP', latitude: -23.59, longitude: -46.68 };
const NEIGHBOR: StoredCep = {
  ...ORIGIN,
  cep: '04551010',
  latitude: ORIGIN.latitude + 0.1 / KM_PER_DEGREE,
};
const ADDRESS = { street: 'Av. Teste', neighborhood: 'Centro', city: 'São Paulo', uf: 'SP' };
const NOMINATIM_HIT: GeocodeLookup = {
  status: 'found',
  candidates: [{ lat: ORIGIN.latitude, lon: ORIGIN.longitude, city: 'São Paulo', uf: 'SP' }],
};

const SUMMARY = '/ceps-proximos/{cep}';
const DETAILED = '/ceps-proximos/{cep}/detalhes';
const HEALTH = '/saude';
const CACHE_ALL = '/cache';
const CACHE_CEP = '/cache/{cep}';

const inMemoryRepository = (items: StoredCep[]): CepRepository => ({
  findLoadedUfs: async () => ['SP'],
  findByCep: async (cep) => items.find((item) => item.cep === cep) ?? null,
  findInBox: async () => items,
});

interface SetupOptions {
  repository?: CepRepository;
  /** Read on every provider call, so a test can change it between requests. */
  lookup?: { current: AddressLookup };
  geocode?: GeocodeLookup;
  failingCache?: boolean;
  /** Makes the cache admin throw a non-AppError, which the error middleware answers with 500. */
  crashingAdmin?: boolean;
  withAdmin?: boolean;
  rateLimit?: number;
}

function setup(options: SetupOptions = {}) {
  const cache = new InMemoryCache();
  const lookup = options.lookup ?? { current: { status: 'found', address: ADDRESS } };
  const originGeocoder = new OriginGeocoder(
    { search: async () => options.geocode ?? { status: 'found', candidates: [] } },
    cache,
    { foundTtlSeconds: 60, noMatchTtlSeconds: 60 },
  );
  const adminCache = new InMemoryCache();
  if (options.failingCache) {
    adminCache.deleteByPrefix = async () => {
      throw new Error('redis down');
    };
    adminCache.delete = async () => {
      throw new Error('redis down');
    };
  }
  const crash = async () => {
    throw new Error('bug');
  };
  return createApp({
    findNearbyCeps: findNearbyCeps(
      options.repository ?? inMemoryRepository([ORIGIN, NEIGHBOR]),
      { lookup: async () => lookup.current },
      originGeocoder,
      cache,
      { radiusKm: 1, resultTtlSeconds: 60 },
    ),
    logger: pino({ level: 'silent' }),
    rateLimit: { limit: options.rateLimit ?? 1000, windowMs: 60_000 },
    cacheAdmin:
      options.withAdmin === false
        ? undefined
        : {
            clearCache: options.crashingAdmin
              ? { all: crash, cep: crash }
              : clearCache(adminCache, { radiusKm: 1 }),
            token: TOKEN,
          },
  });
}

describe('openapi.yaml coverage', () => {
  it('describes the five endpoints', () => {
    expect(Object.keys(openApiDocument.paths).sort()).toEqual(
      [SUMMARY, DETAILED, HEALTH, CACHE_ALL, CACHE_CEP].sort(),
    );
    expect(openApiDocument.paths[SUMMARY]?.get).toBeDefined();
    expect(openApiDocument.paths[DETAILED]?.get).toBeDefined();
    expect(openApiDocument.paths[HEALTH]?.get).toBeDefined();
    expect(openApiDocument.paths[CACHE_ALL]?.delete).toBeDefined();
    expect(openApiDocument.paths[CACHE_CEP]?.delete).toBeDefined();
  });

  it('lists every error code of the catalog in the Erro schema', () => {
    const documented =
      openApiDocument.components.schemas.Erro.properties.erro.properties.codigo.enum;
    const codes = [...Object.values(ERROR_CATALOG), ...Object.values(HTTP_ERRORS)].map(
      (entry) => entry.codigo,
    );
    expect([...new Set(documented)].sort()).toEqual([...new Set(codes)].sort());
  });
});

describe('success responses match the contract', () => {
  it('GET /ceps-proximos/{cep} answers 200', async () => {
    const res = await request(setup()).get('/ceps-proximos/04551000');
    expect(res.status).toBe(200);
    expectMatchesContract(res, SUMMARY, 'get');
  });

  it('GET /ceps-proximos/{cep}/detalhes answers 200 with fonte base and an address', async () => {
    const res = await request(setup()).get('/ceps-proximos/04551000/detalhes');
    expect(res.status).toBe(200);
    expect(res.body.origem).toMatchObject({ fonte: 'base', endereco: { rua: 'Av. Teste' } });
    expectMatchesContract(res, DETAILED, 'get');
  });

  it('GET /ceps-proximos/{cep}/detalhes answers 200 with fonte nominatim and endereco null', async () => {
    // The first call caches the Nominatim origin; the second one finds the address provider down.
    const lookup: { current: AddressLookup } = { current: { status: 'found', address: ADDRESS } };
    const app = setup({ lookup, geocode: NOMINATIM_HIT });
    expect((await request(app).get('/ceps-proximos/01001000/detalhes')).status).toBe(200);
    lookup.current = { status: 'unavailable' };
    const res = await request(app).get('/ceps-proximos/01001000/detalhes');
    expect(res.status).toBe(200);
    expect(res.body.origem).toMatchObject({ fonte: 'nominatim', endereco: null });
    expectMatchesContract(res, DETAILED, 'get');
  });

  it('GET /saude answers 200', async () => {
    const res = await request(setup()).get('/saude');
    expect(res.status).toBe(200);
    expectMatchesContract(res, HEALTH, 'get');
  });

  it.each([
    ['/cache', CACHE_ALL],
    ['/cache/04551000', CACHE_CEP],
  ])('DELETE %s answers 204', async (url, path) => {
    const res = await request(setup()).delete(url).set('Authorization', AUTH);
    expect(res.status).toBe(204);
    expectMatchesContract(res, path, 'delete');
  });
});

describe('error responses match the contract', () => {
  const unavailable = (): { current: AddressLookup } => ({ current: { status: 'unavailable' } });
  const notFound = (): { current: AddressLookup } => ({ current: { status: 'not_found' } });
  const outOfCoverage = (): { current: AddressLookup } => ({
    current: { status: 'found', address: { ...ADDRESS, uf: 'RJ' } },
  });
  const throwingRepository: CepRepository = {
    findByCep: async () => {
      throw new Error('db down');
    },
    findInBox: async () => [],
    findLoadedUfs: async () => [],
  };

  describe.each([
    ['summary', SUMMARY, (cep: string) => `/ceps-proximos/${cep}`],
    ['detailed', DETAILED, (cep: string) => `/ceps-proximos/${cep}/detalhes`],
  ] as const)('on the %s route', (_name, path, url) => {
    it.each([
      [400, 'CEP_INVALIDO', url('123'), {}],
      [400, 'PARAMETRO_INVALIDO', `${url('04551000')}?pagina=0`, {}],
      [400, 'PARAMETRO_INVALIDO', `${url('04551000')}?limite=201`, {}],
      [404, 'CEP_NAO_ENCONTRADO', url('00000000'), { lookup: notFound() }],
      [422, 'CEP_FORA_DA_COBERTURA', url('00000001'), { lookup: outOfCoverage() }],
      [422, 'CEP_SEM_GEOLOCALIZACAO', url('00000001'), {}],
      [503, 'PROVEDOR_INDISPONIVEL', url('00000001'), { lookup: unavailable() }],
      [500, 'ERRO_INTERNO', url('04551000'), { repository: throwingRepository }],
    ] satisfies [number, string, string, SetupOptions][])(
      'answers %i %s for %s',
      async (status, codigo, target, options) => {
        const res = await request(setup(options)).get(target);
        expect(res.status).toBe(status);
        expect(res.body.erro.codigo).toBe(codigo);
        expectMatchesContract(res, path, 'get');
      },
    );
  });

  it.each([
    ['/cache', CACHE_ALL],
    ['/cache/04551000', CACHE_CEP],
  ])('DELETE %s answers 401, 404, 500 and 503', async (url, path) => {
    const unauthorized = await request(setup()).delete(url);
    expect(unauthorized.body.erro.codigo).toBe('NAO_AUTORIZADO');
    expectMatchesContract(unauthorized, path, 'delete');

    // Without CACHE_ADMIN_TOKEN the route is not registered and gets the generic 404.
    const notRegistered = await request(setup({ withAdmin: false }))
      .delete(url)
      .set('Authorization', AUTH);
    expect(notRegistered.body.erro.codigo).toBe('NAO_ENCONTRADO');
    expectMatchesContract(notRegistered, path, 'delete');

    const cacheDown = await request(setup({ failingCache: true }))
      .delete(url)
      .set('Authorization', AUTH);
    expect(cacheDown.body.erro.codigo).toBe('CACHE_INDISPONIVEL');
    expectMatchesContract(cacheDown, path, 'delete');

    const crashed = await request(setup({ crashingAdmin: true }))
      .delete(url)
      .set('Authorization', AUTH);
    expect(crashed.body.erro.codigo).toBe('ERRO_INTERNO');
    expectMatchesContract(crashed, path, 'delete');
  });

  it('DELETE /cache/{cep} answers 400 CEP_INVALIDO', async () => {
    const res = await request(setup()).delete('/cache/123').set('Authorization', AUTH);
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('CEP_INVALIDO');
    expectMatchesContract(res, CACHE_CEP, 'delete');
  });

  it.each([
    ['get', '/ceps-proximos/04551000', SUMMARY],
    ['get', '/ceps-proximos/04551000/detalhes', DETAILED],
    ['get', '/saude', HEALTH],
    ['delete', '/cache', CACHE_ALL],
    ['delete', '/cache/04551000', CACHE_CEP],
  ] as const)('%s %s answers 429 LIMITE_EXCEDIDO', async (method, url, path) => {
    const app = setup({ rateLimit: 1 });
    await request(app)[method](url).set('Authorization', AUTH);
    const res = await request(app)[method](url).set('Authorization', AUTH);
    expect(res.status).toBe(429);
    expect(res.body.erro.codigo).toBe('LIMITE_EXCEDIDO');
    expectMatchesContract(res, path, method);
  });
});
