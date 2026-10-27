import { Router, type Request } from 'express';
import type { CepAddress } from '../../application/cep-address-provider.js';
import type { findNearbyCeps, NearbyCepsResult } from '../../application/find-nearby-ceps.js';

// Query values arrive as strings; anything that is not a plain number becomes NaN and is rejected by the use case.
const parseQueryNumber = (value: unknown) =>
  value === undefined ? undefined : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;

const round2 = (value: number) => Math.round(value * 100) / 100;

const toPagination = ({ pagination }: NearbyCepsResult) => ({
  pagina: pagination.page,
  limite: pagination.limit,
  total: pagination.total,
  total_paginas: pagination.totalPages,
});

const toCeps = ({ neighbors }: NearbyCepsResult) =>
  neighbors.map((n) => ({ cep: n.cep, distancia_km: round2(n.distanceKm) }));

const toAddress = (address: CepAddress | null) =>
  address && {
    rua: address.street,
    bairro: address.neighborhood,
    cidade: address.city,
    uf: address.uf,
  };

export function toSummaryResponse(result: NearbyCepsResult) {
  return {
    origem: result.origin.cep,
    paginacao: toPagination(result),
    ceps: toCeps(result),
  };
}

export function toDetailedResponse(result: NearbyCepsResult) {
  const { origin } = result;
  return {
    origem: {
      cep: origin.cep,
      latitude: origin.lat,
      longitude: origin.lon,
      fonte: 'base',
      endereco: toAddress(origin.address),
    },
    raio_km: result.radiusKm,
    paginacao: toPagination(result),
    ceps: toCeps(result),
  };
}

export function nearbyCepsRouter(find: ReturnType<typeof findNearbyCeps>): Router {
  const router = Router();
  const input = (req: Request, withAddress: boolean) => ({
    cep: req.params.cep as string,
    page: parseQueryNumber(req.query.pagina),
    limit: parseQueryNumber(req.query.limite),
    withAddress,
  });
  router.get('/ceps-proximos/:cep', async (req, res) => {
    res.json(toSummaryResponse(await find(input(req, false))));
  });
  router.get('/ceps-proximos/:cep/detalhes', async (req, res) => {
    res.json(toDetailedResponse(await find(input(req, true))));
  });
  return router;
}
