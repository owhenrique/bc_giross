import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { AppError, type AppErrorKind } from '../../application/errors.js';

export interface ErrorCatalogEntry {
  status: number;
  codigo: string;
  mensagem: string;
}

export const ERROR_CATALOG: Record<AppErrorKind, ErrorCatalogEntry> = {
  invalid_cep: { status: 400, codigo: 'CEP_INVALIDO', mensagem: 'CEP inválido' },
  invalid_page: {
    status: 400,
    codigo: 'PARAMETRO_INVALIDO',
    mensagem: 'pagina deve ser um inteiro maior ou igual a 1',
  },
  invalid_limit: {
    status: 400,
    codigo: 'PARAMETRO_INVALIDO',
    mensagem: 'limite deve ser um inteiro entre 1 e 200',
  },
  cep_not_found: { status: 404, codigo: 'CEP_NAO_ENCONTRADO', mensagem: 'CEP não encontrado' },
  cep_out_of_coverage: {
    status: 422,
    codigo: 'CEP_FORA_DA_COBERTURA',
    mensagem: 'CEP fora da cobertura da base',
  },
  cep_without_location: {
    status: 422,
    codigo: 'CEP_SEM_GEOLOCALIZACAO',
    mensagem: 'Não foi possível obter a coordenada do CEP',
  },
  address_provider_unavailable: {
    status: 503,
    codigo: 'PROVEDOR_INDISPONIVEL',
    mensagem: 'Serviço de consulta de CEP indisponível',
  },
  cache_unavailable: {
    status: 503,
    codigo: 'CACHE_INDISPONIVEL',
    mensagem: 'Não foi possível limpar o cache',
  },
  rate_limit_exceeded: {
    status: 429,
    codigo: 'LIMITE_EXCEDIDO',
    mensagem: 'Limite de requisições excedido',
  },
};

/** Errors raised by the HTTP layer itself, outside the use cases. */
export const HTTP_ERRORS = {
  unauthorized: {
    status: 401,
    codigo: 'NAO_AUTORIZADO',
    mensagem: 'Token de acesso inválido ou ausente',
  },
  routeNotFound: { status: 404, codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado' },
  badRequest: { status: 400, codigo: 'PARAMETRO_INVALIDO', mensagem: 'Requisição inválida' },
  internal: { status: 500, codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' },
} satisfies Record<string, ErrorCatalogEntry>;

export function sendError(res: Response, { status, codigo, mensagem }: ErrorCatalogEntry): void {
  res.status(status).json({ erro: { codigo, mensagem } });
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, HTTP_ERRORS.routeNotFound);
};

// Express identifies error handlers by their 4-argument arity, so `_next` must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    const entry = ERROR_CATALOG[err.kind] as ErrorCatalogEntry | undefined;
    if (entry) {
      sendError(res, entry);
      return;
    }
  }
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status >= 400 && status < 500) {
    sendError(res, HTTP_ERRORS.badRequest);
    return;
  }
  req.log.error({ err }, 'unexpected error');
  sendError(res, HTTP_ERRORS.internal);
};
