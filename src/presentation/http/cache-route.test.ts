import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { addressKey, geocodeKey, resultKey, type Cache } from '../../application/cache.js';
import { clearCache } from '../../application/clear-cache.js';
import { InMemoryCache } from '../../infrastructure/cache/in-memory-cache.js';
import { createApp } from './app.js';
import type { findNearbyCeps } from '../../application/find-nearby-ceps.js';

const TOKEN = 'a-secret-token-123';
const RADIUS_KM = 1;
const UNAUTHORIZED_BODY = {
  erro: { codigo: 'NAO_AUTORIZADO', mensagem: 'Token de acesso inválido ou ausente' },
};

async function seed(cache: Cache) {
  for (const key of [
    addressKey('04551000'),
    geocodeKey('04551000'),
    resultKey(RADIUS_KM, '04551000'),
    addressKey('01001000'),
    resultKey(RADIUS_KM, '01001000'),
    'outra:chave',
  ]) {
    await cache.set(key, 'v', 60);
  }
}

function setup(options: { withAdmin?: boolean; cache?: Cache } = {}) {
  const cache = options.cache ?? new InMemoryCache();
  const app = createApp({
    findNearbyCeps: (() => {
      throw new Error('not used');
    }) as unknown as ReturnType<typeof findNearbyCeps>,
    logger: pino({ level: 'silent' }),
    rateLimit: { limit: 1000, windowMs: 60_000 },
    cacheAdmin:
      options.withAdmin === false
        ? undefined
        : { clearCache: clearCache(cache, { radiusKm: RADIUS_KM }), token: TOKEN },
  });
  return { app, cache };
}

describe('cache admin routes', () => {
  it('DELETE /cache clears the app prefixes only and answers 204', async () => {
    const { app, cache } = setup();
    await seed(cache);
    const res = await request(app).delete('/cache').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await cache.get(addressKey('01001000'))).toBeNull();
    expect(await cache.get(resultKey(RADIUS_KM, '04551000'))).toBeNull();
    expect(await cache.get(geocodeKey('04551000'))).toBeNull();
    expect(await cache.get('outra:chave')).toBe('v');
  });

  it('DELETE /cache/:cep clears only that CEP and answers 204', async () => {
    const { app, cache } = setup();
    await seed(cache);
    const res = await request(app)
      .delete('/cache/04551000')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await cache.get(addressKey('04551000'))).toBeNull();
    expect(await cache.get(geocodeKey('04551000'))).toBeNull();
    expect(await cache.get(resultKey(RADIUS_KM, '04551000'))).toBeNull();
    expect(await cache.get(addressKey('01001000'))).toBe('v');
    expect(await cache.get('outra:chave')).toBe('v');
  });

  it('DELETE /cache/ with a trailing slash hits the clear-all route', async () => {
    const { app, cache } = setup();
    await seed(cache);
    const res = await request(app).delete('/cache/').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(204);
    expect(await cache.get(addressKey('01001000'))).toBeNull();
    expect(await cache.get('outra:chave')).toBe('v');
  });

  it('DELETE /cache/04551-000 behaves like the plain CEP', async () => {
    const { app, cache } = setup();
    await seed(cache);
    const res = await request(app)
      .delete('/cache/04551-000')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(204);
    expect(await cache.get(addressKey('04551000'))).toBeNull();
    expect(await cache.get(addressKey('01001000'))).toBe('v');
  });

  it('is idempotent on an empty cache', async () => {
    const { app } = setup();
    const auth = `Bearer ${TOKEN}`;
    expect((await request(app).delete('/cache/04551000').set('Authorization', auth)).status).toBe(
      204,
    );
    expect((await request(app).delete('/cache').set('Authorization', auth)).status).toBe(204);
  });

  it('accepts the Bearer scheme case-insensitively', async () => {
    const { app } = setup();
    const res = await request(app).delete('/cache').set('Authorization', `bearer ${TOKEN}`);
    expect(res.status).toBe(204);
  });

  it.each([
    ['no header', undefined],
    ['a non-Bearer scheme', 'Basic xyz'],
    ['the bare token without a scheme', TOKEN],
    ['a wrong token', 'Bearer wrong-token-value'],
    ['a token of a different length', 'Bearer x'],
  ])('answers 401 with %s and clears nothing', async (_name, header) => {
    const { app, cache } = setup();
    await seed(cache);
    for (const path of ['/cache', '/cache/04551000']) {
      const req = request(app).delete(path);
      const res = await (header === undefined ? req : req.set('Authorization', header));
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.body).toEqual(UNAUTHORIZED_BODY);
    }
    expect(await cache.get(addressKey('04551000'))).toBe('v');
    expect(await cache.get(addressKey('01001000'))).toBe('v');
  });

  it('authenticates before validating the CEP', async () => {
    const { app } = setup();
    const res = await request(app).delete('/cache/123').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('answers 400 CEP_INVALIDO for an invalid CEP with the right token', async () => {
    const { app } = setup();
    const res = await request(app).delete('/cache/123').set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body.erro.codigo).toBe('CEP_INVALIDO');
  });

  it('answers the generic 404 when cacheAdmin is not configured', async () => {
    const { app } = setup({ withAdmin: false });
    for (const path of ['/cache', '/cache/04551000']) {
      for (const header of [undefined, `Bearer ${TOKEN}`]) {
        const req = request(app).delete(path);
        const res = await (header ? req.set('Authorization', header) : req);
        expect(res.status).toBe(404);
        expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
      }
    }
  });

  it('answers 503 CACHE_INDISPONIVEL when the cache fails', async () => {
    const failing = new InMemoryCache();
    failing.deleteByPrefix = async () => {
      throw new Error('redis down');
    };
    failing.delete = async () => {
      throw new Error('redis down');
    };
    const { app } = setup({ cache: failing });
    for (const path of ['/cache', '/cache/04551000']) {
      const res = await request(app).delete(path).set('Authorization', `Bearer ${TOKEN}`);
      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        erro: { codigo: 'CACHE_INDISPONIVEL', mensagem: 'Não foi possível limpar o cache' },
      });
    }
  });
});
