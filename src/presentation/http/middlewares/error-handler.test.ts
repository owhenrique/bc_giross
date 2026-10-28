import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  AddressProviderUnavailableError,
  CepNotFoundError,
  CepOutOfCoverageError,
  CepWithoutLocationError,
  InvalidCepError,
  InvalidLimitError,
  InvalidPageError,
} from '../../../application/errors/errors.js';
import { ERROR_CATALOG } from '../errors/errors.js';
import { errorHandler } from './error-handler.js';

function run(err: unknown) {
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json } as unknown as Response;
  const error = vi.fn();
  const req = { log: { error } } as unknown as Request;
  errorHandler(err, req, res, vi.fn() as unknown as NextFunction);
  return { res, json, error };
}

describe('errorHandler', () => {
  it.each([
    new InvalidCepError(),
    new InvalidPageError(),
    new InvalidLimitError(),
    new CepNotFoundError(),
    new CepOutOfCoverageError(),
    new CepWithoutLocationError(),
    new AddressProviderUnavailableError(),
  ])('maps $kind to its catalog entry', (err) => {
    const { res, json, error } = run(err);
    const entry = ERROR_CATALOG[err.kind];
    expect(res.status).toHaveBeenCalledWith(entry.status);
    expect(json).toHaveBeenCalledWith({ erro: { codigo: entry.codigo, mensagem: entry.mensagem } });
    expect(error).not.toHaveBeenCalled();
  });

  it('maps an AppError missing from the catalog to a logged 500', () => {
    class UnknownError extends AppError {
      readonly kind = 'unknown' as never;
    }
    const { res, json, error } = run(new UnknownError());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno' },
    });
    expect(error).toHaveBeenCalled();
  });

  it('maps a plain error to a 500 without stack', () => {
    const { res, json, error } = run(new Error('boom'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls[0])).not.toContain('stack');
    expect(error).toHaveBeenCalled();
  });
});
