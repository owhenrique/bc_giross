import { Router } from 'express';

export function healthRouter(): Router {
  const router = Router();
  router.get('/saude', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return router;
}
