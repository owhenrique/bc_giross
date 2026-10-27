import { Router } from 'express';
import type { findNearbyCeps, NearbyCepsResult } from '../../application/find-nearby-ceps.js';
import { ErrorCode, sendError } from './errors.js';

const PAGINATION_MESSAGES = {
  page: 'pagina deve ser um inteiro maior ou igual a 1',
  limit: 'limite deve ser um inteiro entre 1 e 200',
};

// Query values arrive as strings; anything that is not a plain number becomes NaN and is rejected by the use case.
const parseQueryNumber = (value: unknown) =>
  value === undefined ? undefined : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;

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
    const result = await find({
      cep: req.params.cep,
      page: parseQueryNumber(req.query.pagina),
      limit: parseQueryNumber(req.query.limite),
    });
    switch (result.status) {
      case 'invalid_cep':
        return sendError(res, 400, ErrorCode.InvalidCep, 'CEP inválido');
      case 'invalid_pagination':
        return sendError(res, 400, ErrorCode.InvalidParameter, PAGINATION_MESSAGES[result.field]);
      case 'not_found':
        return sendError(res, 404, ErrorCode.CepNotFound, 'CEP não encontrado');
      case 'found':
        return res.json(toResponse(result));
    }
  });
  return router;
}
