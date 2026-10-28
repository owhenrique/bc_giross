import { apiReference } from '@scalar/express-api-reference';
import { Router } from 'express';

const SCALAR_BUNDLE = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0/esm.js';

export function docsRouter(document: object): Router {
  const router = Router();
  router.get('/docs/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.get('/docs', apiReference({ url: '/docs/openapi.json', bundle: SCALAR_BUNDLE }));
  return router;
}
