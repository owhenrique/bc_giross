export const APP_ERROR_KINDS = [
  'invalid_cep',
  'invalid_page',
  'invalid_limit',
  'cep_not_found',
  'cep_out_of_coverage',
  'cep_without_location',
  'address_provider_unavailable',
  'cache_unavailable',
  'rate_limit_exceeded',
] as const;

export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];

export abstract class AppError extends Error {
  abstract readonly kind: AppErrorKind;
}

export class InvalidCepError extends AppError {
  readonly kind = 'invalid_cep';
  override readonly name = 'InvalidCepError';
}

export class InvalidPageError extends AppError {
  readonly kind = 'invalid_page';
  override readonly name = 'InvalidPageError';
}

export class InvalidLimitError extends AppError {
  readonly kind = 'invalid_limit';
  override readonly name = 'InvalidLimitError';
}

export class CepNotFoundError extends AppError {
  readonly kind = 'cep_not_found';
  override readonly name = 'CepNotFoundError';
}

export class CepOutOfCoverageError extends AppError {
  readonly kind = 'cep_out_of_coverage';
  override readonly name = 'CepOutOfCoverageError';
}

export class CepWithoutLocationError extends AppError {
  readonly kind = 'cep_without_location';
  override readonly name = 'CepWithoutLocationError';
}

export class AddressProviderUnavailableError extends AppError {
  readonly kind = 'address_provider_unavailable';
  override readonly name = 'AddressProviderUnavailableError';
}

export class CacheUnavailableError extends AppError {
  readonly kind = 'cache_unavailable';
  override readonly name = 'CacheUnavailableError';
}

export class RateLimitExceededError extends AppError {
  readonly kind = 'rate_limit_exceeded';
  override readonly name = 'RateLimitExceededError';
}
