import { Request, Response, NextFunction } from 'express';
import { Logger } from '../logger/logger';
import { getCorrelationContext } from '../logger/correlation';

/**
 * Logs one entry per request at completion (response 'finish' event), capturing
 * method, path, status_code, response_time_ms, and — when an upstream auth
 * middleware has populated req.user — user_id.
 *
 * The logger's AsyncLocalStorage wrapper automatically attaches correlation_id,
 * so it does NOT need to be passed explicitly. Must be mounted AFTER
 * correlationIdMiddleware for the context to be present.
 *
 * The `req.user` type is augmented module-wide by WO-007's auth middleware.
 */
export function createRequestLoggerMiddleware(logger: Logger) {
  return function requestLoggerMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const elapsedNs = process.hrtime.bigint() - start;
      const response_time_ms = Number(elapsedNs) / 1_000_000;

      const ctx = getCorrelationContext();
      const user_id = req.user?.id ?? ctx?.user_id;

      logger.info('request_completed', {
        method: req.method,
        path: req.originalUrl || req.url,
        status_code: res.statusCode,
        response_time_ms: Math.round(response_time_ms * 1000) / 1000,
        ...(user_id ? { user_id } : {}),
      });
    });

    next();
  };
}
