import { Router } from 'express';
import { z } from 'zod';
import type { findNearbyCeps, NearbyCepsResult } from '../../application/find-nearby-ceps.js';
import { normalizeCep } from '../../domain/cep/cep-code.js';
import { ErrorCode, sendError } from './errors.js';

export const querySchema = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .transform(({ pagina, limite }) => ({ page: pagina, limit: limite }));

const round2 = (value: number) => Math.round(value * 100) / 100;

export function toResponse(result: Extract<NearbyCepsResult, { status: 'found' }>) {
  const { origin, pagination, neighbors } = result;
  return {
    origem: { cep: origin.cep, latitude: origin.lat, longitude: origin.lon, fonte: 'base' },
    raio_km: result.radiusKm,
    paginacao: {
      pagina: pagination.page,
      limite: pagination.limit,
      total: pagination.total,
      total_paginas: pagination.totalPages,
    },
    ceps: neighbors.map((n) => ({ cep: n.cep, distancia_km: round2(n.distanceKm) })),
  };
}

export function nearbyCepsRouter(find: ReturnType<typeof findNearbyCeps>): Router {
  const router = Router();
  router.get('/ceps-proximos/:cep', async (req, res) => {
    const cep = normalizeCep(req.params.cep);
    if (!cep) return sendError(res, 400, ErrorCode.InvalidCep, 'CEP inválido');
    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      return sendError(res, 400, ErrorCode.InvalidParameter, query.error.issues[0]?.message ?? 'Parâmetro inválido');
    }
    const result = await find({ cep, ...query.data });
    if (result.status === 'not_found') return sendError(res, 404, ErrorCode.CepNotFound, 'CEP não encontrado');
    res.json(toResponse(result));
  });
  return router;
}
