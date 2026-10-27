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
};
