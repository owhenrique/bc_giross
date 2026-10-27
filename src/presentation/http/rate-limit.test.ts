import express from 'express';
import { MemoryStore, type Store } from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler, notFoundHandler } from './errors.js';
import { rateLimitMiddleware } from './rate-limit.js';

const logger = () => ({ warn: vi.fn() });

function appWith(options: { store?: Store; trustProxy?: number; log?: { warn: () => void } } = {}) {
  const app = express();
  app.set('trust proxy', options.trustProxy ?? false);
  app.use(
    rateLimitMiddleware({
      limit: 2,
      windowMs: 60_000,
      store: options.store,
      logger: options.log ?? logger(),
    }),
  );
  app.get('/ok', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('rateLimitMiddleware', () => {
  it('answers 429 LIMITE_EXCEDIDO with Retry-After and draft-8 headers past the limit', async () => {
    const app = appWith();
    await request(app).get('/ok');
    await request(app).get('/ok');
    const res = await request(app).get('/ok');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      erro: { codigo: 'LIMITE_EXCEDIDO', mensagem: 'Limite de requisições excedido' },
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['ratelimit']).toBeDefined();
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('counts unknown routes too', async () => {
    const app = appWith();
    await request(app).get('/nope');
    await request(app).get('/nope');
    expect((await request(app).get('/nope')).status).toBe(429);
  });

  it('keeps separate counters per forwarded IP with trustProxy', async () => {
    const app = appWith({ trustProxy: 1 });
    for (let i = 0; i < 2; i++) await request(app).get('/ok').set('X-Forwarded-For', '1.1.1.1');
    expect((await request(app).get('/ok').set('X-Forwarded-For', '1.1.1.1')).status).toBe(429);
    expect((await request(app).get('/ok').set('X-Forwarded-For', '2.2.2.2')).status).toBe(200);
  });

  it('shares one counter without trustProxy', async () => {
    const app = appWith();
    await request(app).get('/ok').set('X-Forwarded-For', '1.1.1.1');
    await request(app).get('/ok').set('X-Forwarded-For', '2.2.2.2');
    expect((await request(app).get('/ok').set('X-Forwarded-For', '3.3.3.3')).status).toBe(429);
  });

  it('fails open and warns when the store throws', async () => {
    const log = logger();
    const failing = new MemoryStore();
    failing.increment = () => Promise.reject(new Error('store down'));
    const res = await request(appWith({ store: failing, log })).get('/ok');
    expect(res.status).toBe(200);
    expect(log.warn).toHaveBeenCalled();
  });

  it('counts once when mounted on the app and again on a router at the same path', async () => {
    const app = express();
    const mount = () => rateLimitMiddleware({ limit: 2, windowMs: 60_000, logger: logger() });
    const router = express.Router();
    router.use(mount());
    router.get('/ok', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(mount());
    app.use(router);
    app.use(notFoundHandler);
    app.use(errorHandler);
    const first = await request(app).get('/ok');
    const second = await request(app).get('/ok');
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.headers['ratelimit']).toContain('r=0');
    expect((await request(app).get('/ok')).status).toBe(429);
  });
});
