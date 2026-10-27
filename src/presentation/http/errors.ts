import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { AppError } from '../../application/errors.js';
import { ERROR_CATALOG } from './error-catalog.js';

export const ErrorCode = {
  InvalidCep: 'CEP_INVALIDO',
  InvalidParameter: 'PARAMETRO_INVALIDO',
  CepNotFound: 'CEP_NAO_ENCONTRADO',
  CepOutOfCoverage: 'CEP_FORA_DA_COBERTURA',
  CepWithoutLocation: 'CEP_SEM_GEOLOCALIZACAO',
  ProviderUnavailable: 'PROVEDOR_INDISPONIVEL',
  NotFound: 'NAO_ENCONTRADO',
  Internal: 'ERRO_INTERNO',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function sendError(res: Response, status: number, code: ErrorCode, message: string): void {
  res.status(status).json({ erro: { codigo: code, mensagem: message } });
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, ErrorCode.NotFound, 'Recurso não encontrado');
};

// Express identifies error handlers by their 4-argument arity, so `_next` must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    const entry = ERROR_CATALOG[err.kind] as (typeof ERROR_CATALOG)[typeof err.kind] | undefined;
    if (entry) {
      sendError(res, entry.status, entry.codigo, entry.mensagem);
      return;
    }
  }
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status >= 400 && status < 500) {
    sendError(res, 400, ErrorCode.InvalidParameter, 'Requisição inválida');
    return;
  }
  req.log.error({ err }, 'unexpected error');
  sendError(res, 500, ErrorCode.Internal, 'Erro interno');
};
