import { apiReference } from '@scalar/express-api-reference';
import { Router } from 'express';

/** Serves the OpenAPI document as JSON and the Scalar UI that renders it. */
export function docsRouter(document: object): Router {
  const router = Router();
  // Registered before the Scalar handler, which would otherwise answer every path under /docs.
  router.get('/docs/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use('/docs', apiReference({ url: '/docs/openapi.json' }));
  return router;
}
