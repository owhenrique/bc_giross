import { describe, expect, it } from 'vitest';
import {
  AppError,
  AddressProviderUnavailableError,
  CepNotFoundError,
  CepOutOfCoverageError,
  CepWithoutLocationError,
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
    ['CepOutOfCoverageError', CepOutOfCoverageError, 'cep_out_of_coverage'],
    ['CepWithoutLocationError', CepWithoutLocationError, 'cep_without_location'],
    ['AddressProviderUnavailableError', AddressProviderUnavailableError, 'address_provider_unavailable'],
  ] as const)('%s has a fixed kind and is an AppError', (name, ErrorClass, kind) => {
    const error = new ErrorClass('message');
    expect(error.kind).toBe(kind);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.message).toBe('message');
  });
});
