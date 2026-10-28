import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { findNearbyCeps } from '../../../application/use-cases/find-nearby-ceps.js';
import { createApp } from '../app.js';

function setup(limit = 1000) {
  const calls = { find: 0 };
  const app = createApp({
    findNearbyCeps: (async () => {
      calls.find++;
      throw new Error('not used');
    }) as unknown as ReturnType<typeof findNearbyCeps>,
    logger: pino({ level: 'silent' }),
    rateLimit: { limit, windowMs: 60_000 },
  });
  return { app, calls };
}

describe('GET /saude', () => {
  it('answers 200 with a fixed { status: "ok" } body', async () => {
    const { app } = setup();
    const res = await request(app).get('/saude');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('touches no dependency', async () => {
    const { app, calls } = setup();
    await request(app).get('/saude');
    expect(calls.find).toBe(0);
  });

  it('falls to the generic 404 for other methods', async () => {
    const { app } = setup();
    const res = await request(app).post('/saude');
    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
  });

  it('counts in the rate limit like any route', async () => {
    const { app } = setup(1);
    expect((await request(app).get('/saude')).status).toBe(200);
    const res = await request(app).get('/saude');
    expect(res.status).toBe(429);
    expect(res.body.erro.codigo).toBe('LIMITE_EXCEDIDO');
  });
});
