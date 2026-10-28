import { apiReference } from '@scalar/express-api-reference';
import { Router } from 'express';

/** Pinned so a new Scalar release cannot change or break the UI without a code change. */
const SCALAR_BUNDLE = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.74.0/esm.js';

/** Serves the OpenAPI document as JSON and the Scalar UI that renders it. */
export function docsRouter(document: object): Router {
  const router = Router();
  router.get('/docs/openapi.json', (_req, res) => {
    res.json(document);
  });
  // `get` matches only /docs itself; any other path under it falls to the generic 404.
  router.get('/docs', apiReference({ url: '/docs/openapi.json', bundle: SCALAR_BUNDLE }));
  return router;
}
