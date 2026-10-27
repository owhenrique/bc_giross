export const APP_ERROR_KINDS = ['invalid_cep', 'invalid_page', 'invalid_limit', 'cep_not_found'] as const;

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
