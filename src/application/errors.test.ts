import { describe, expect, it } from 'vitest';
import {
  AppError,
  CepNotFoundError,
  InvalidCepError,
  InvalidLimitError,
  InvalidPageError,
} from './errors.js';

describe('application errors', () => {
  it.each([
    ['InvalidCepError', InvalidCepError, 'invalid_cep'],
    ['InvalidPageError', InvalidPageError, 'invalid_page'],
    ['InvalidLimitError', InvalidLimitError, 'invalid_limit'],
    ['CepNotFoundError', CepNotFoundError, 'cep_not_found'],
  ] as const)('%s has a fixed kind and is an AppError', (name, ErrorClass, kind) => {
    const error = new ErrorClass('message');
    expect(error.kind).toBe(kind);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.message).toBe('message');
  });
});
