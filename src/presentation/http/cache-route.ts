import { Router } from 'express';
import type { clearCache } from '../../application/clear-cache.js';
import { requireBearerToken } from './bearer-auth.js';

export function cacheRouter(clear: ReturnType<typeof clearCache>, token: string): Router {
  const router = Router();
  const auth = requireBearerToken(token);
  router.delete('/cache', auth, async (_req, res) => {
    await clear.all();
    res.status(204).end();
  });
  router.delete('/cache/:cep', auth, async (req, res) => {
    await clear.cep(req.params.cep as string);
    res.status(204).end();
  });
  return router;
}
