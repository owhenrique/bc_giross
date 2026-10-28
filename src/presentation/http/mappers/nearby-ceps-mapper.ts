import type { Request } from 'express';
import type { CepAddress } from '../../../application/providers/cep-address-provider.js';
import type {
  FindNearbyCepsInput,
  NearbyCepsResult,
} from '../../../application/use-cases/find-nearby-ceps.js';

// Query values arrive as strings; anything that is not a plain number becomes NaN and is rejected by the use case.
const parseQueryNumber = (value: unknown) =>
  value === undefined
    ? undefined
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : NaN;

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
      fonte: origin.source === 'nominatim' ? 'nominatim' : 'base',
      endereco: toAddress(origin.address),
    },
    raio_km: result.radiusKm,
    paginacao: toPagination(result),
    ceps: toCeps(result),
  };
}

export function toNearbyCepsInput(req: Request, withAddress: boolean): FindNearbyCepsInput {
  return {
    cep: req.params.cep as string,
    page: parseQueryNumber(req.query.pagina),
    limit: parseQueryNumber(req.query.limite),
    withAddress,
  };
}
