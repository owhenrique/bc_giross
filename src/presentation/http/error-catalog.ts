import type { AppErrorKind } from '../../application/errors.js';
import type { ErrorCode } from './errors.js';

export interface ErrorCatalogEntry {
  status: number;
  codigo: ErrorCode;
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
