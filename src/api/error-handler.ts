import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './errors';
import { Logger } from '../logger';
import { getCorrelationId } from '../logger/correlation';

/**
 * Centralized Express error handler (AC #5).
 *
 * Status mapping:
 *   - ApiError subclasses → their declared `status` (400/401/403/404/409/429)
 *   - Bare ZodError       → 400 with field details (defense-in-depth — validate()
 *                            middleware already converts these, but a service-layer
 *                            Zod parse without the middleware should still 400)
 *   - Anything else       → 500
 *
 * Response shape:
 *   { error: <code>, message: <human-readable>, correlation_id, details? }
 *
 * The correlation_id surfaces here so frontend / support can match a user-
 * visible error to the structured log entry produced by WO-005.
 */
export interface ErrorResponseBody {
  error: string;
  message: string;
  correlation_id?: string;
  details?: unknown;
}

export function createErrorHandler(logger: Logger) {
  return function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (res.headersSent) {
      // Once we've started streaming, we have to delegate to Express's default
      // handler — it'll close the connection. Logging still happens.
      return next(err);
    }

    const correlation_id = getCorrelationId();
    let status: number;
    let body: ErrorResponseBody;

    // Some upstream middlewares (express.json body limit, multer file size,
    // express-rate-limit) throw native Errors with a numeric `status` /
    // `statusCode` property. Honor that so a 413 from the body parser doesn't
    // get bucketed into the 500 "internal_server_error" path.
    const upstreamStatus =
      (err as { status?: number }).status ??
      (err as { statusCode?: number }).statusCode;
    const isUpstreamHttpError =
      typeof upstreamStatus === 'number' && upstreamStatus >= 400 && upstreamStatus < 500;

    if (err instanceof ApiError) {
      status = err.status;
      body = {
        error: err.code,
        message: err.message,
        ...(correlation_id ? { correlation_id } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      };
    } else if (isUpstreamHttpError) {
      status = upstreamStatus!;
      body = {
        error: codeFromStatus(status),
        message: err.message || codeFromStatus(status),
        ...(correlation_id ? { correlation_id } : {}),
      };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: 'validation_failed',
        message: 'Request validation failed',
        ...(correlation_id ? { correlation_id } : {}),
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      };
    } else {
      status = 500;
      body = {
        error: 'internal_server_error',
        message: 'An unexpected error occurred',
        ...(correlation_id ? { correlation_id } : {}),
      };
    }

    const log_meta: Record<string, unknown> = {
      method: req.method,
      path: req.originalUrl || req.url,
      status_code: status,
      error_name: err.name,
      error_message: err.message,
    };
    if (status >= 500) {
      log_meta.stack = err.stack;
      logger.error('request_failed', log_meta);
    } else {
      logger.warn('request_failed', log_meta);
    }

    res.status(status).json(body);
  };
}

function codeFromStatus(status: number): string {
  switch (status) {
    case 400: return 'bad_request';
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 413: return 'payload_too_large';
    case 429: return 'rate_limited';
    default: return `http_${status}`;
  }
}

/** Tail middleware for unmatched routes — converts to a NotFoundError handled above. */
export function notFoundHandler() {
  return function notFound(req: Request, _res: Response, next: NextFunction): void {
    next(
      new (class extends ApiError {
        constructor() {
          super('not_found', `Route ${req.method} ${req.path} not found`, 404);
        }
      })(),
    );
  };
}
