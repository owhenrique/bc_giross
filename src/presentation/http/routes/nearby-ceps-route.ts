import { Router } from 'express';
import type { findNearbyCeps } from '../../../application/use-cases/find-nearby-ceps.js';
import {
  toDetailedResponse,
  toNearbyCepsInput,
  toSummaryResponse,
} from '../mappers/nearby-ceps-mapper.js';

export function nearbyCepsRouter(find: ReturnType<typeof findNearbyCeps>): Router {
  const router = Router();
  router.get('/ceps-proximos/:cep', async (req, res) => {
    res.json(toSummaryResponse(await find(toNearbyCepsInput(req, false))));
  });
  router.get('/ceps-proximos/:cep/detalhes', async (req, res) => {
    res.json(toDetailedResponse(await find(toNearbyCepsInput(req, true))));
  });
  return router;
}
