import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../../../application/errors/errors.js';
import { ERROR_CATALOG, HTTP_ERRORS, sendError, type ErrorCatalogEntry } from '../errors/errors.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, HTTP_ERRORS.routeNotFound);
};

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
