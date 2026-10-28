import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { findNearbyCeps } from '../../../application/use-cases/find-nearby-ceps.js';
import { createApp } from '../app.js';

const openApiDocument = { openapi: '3.1.0', info: { title: 'test', version: '0' }, paths: {} };

function setup(options: { withDocs?: boolean; limit?: number } = {}) {
  return createApp({
    findNearbyCeps: (() => {
      throw new Error('not used');
    }) as unknown as ReturnType<typeof findNearbyCeps>,
    logger: pino({ level: 'silent' }),
    rateLimit: { limit: options.limit ?? 1000, windowMs: 60_000 },
    openApiDocument: options.withDocs === false ? undefined : openApiDocument,
  });
}

describe('GET /docs', () => {
  it('serves the Scalar UI pointing to /docs/openapi.json', async () => {
    const res = await request(setup()).get('/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/docs/openapi.json');
    expect(res.text).toContain('@scalar/api-reference@1.74.0/esm.js');
  });

  it('falls to the generic 404 on other paths under /docs', async () => {
    const res = await request(setup()).get('/docs/qualquer-coisa');
    expect(res.status).toBe(404);
    expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
  });

  it('serves the injected OpenAPI document as JSON', async () => {
    const res = await request(setup()).get('/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual(openApiDocument);
  });

  it.each(['/docs', '/docs/openapi.json'])(
    'falls to the generic 404 on %s without a document',
    async (path) => {
      const res = await request(setup({ withDocs: false })).get(path);
      expect(res.status).toBe(404);
      expect(res.body.erro.codigo).toBe('NAO_ENCONTRADO');
    },
  );

  it.each(['/docs', '/docs/openapi.json'])('counts %s in the rate limit', async (path) => {
    const app = setup({ limit: 1 });
    expect((await request(app).get(path)).status).toBe(200);
    const res = await request(app).get(path);
    expect(res.status).toBe(429);
    expect(res.body.erro.codigo).toBe('LIMITE_EXCEDIDO');
  });
});
