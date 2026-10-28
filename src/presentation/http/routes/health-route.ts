import { Router } from 'express';

/** Answers while the process serves HTTP; it checks no dependency (database, cache or providers). */
export function healthRouter(): Router {
  const router = Router();
  router.get('/saude', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return router;
}
