import { Request, Response, NextFunction } from 'express';
import { Metrics } from './registry';

/**
 * Records http_request_duration_seconds, http_requests_total, and updates
 * active_connections for every HTTP request. Mount BEFORE route handlers so
 * `req.route?.path` is populated by the time the response finishes — falls
 * back to the raw path when no route was matched (e.g., 404s).
 */
export function createHttpMetricsMiddleware(metrics: Metrics) {
  return function httpMetricsMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    metrics.activeConnections.inc();
    const endTimer = metrics.httpRequestDuration.startTimer();

    const finalize = (): void => {
      const labels = {
        method: req.method,
        route: routeOf(req),
        status_code: String(res.statusCode),
      };
      endTimer(labels);
      metrics.httpRequestsTotal.inc(labels);
      metrics.activeConnections.dec();
    };

    let finalized = false;
    const once = (): void => {
      if (finalized) return;
      finalized = true;
      finalize();
    };

    res.on('finish', once);
    // Also decrement if the client aborts before finish, so the gauge doesn't drift.
    res.on('close', once);

    next();
  };
}

function routeOf(req: Request): string {
  // Prefer the matched route template (e.g., /users/:id) over the raw URL,
  // so high-cardinality path params don't blow up label cardinality.
  if (req.route?.path) {
    const base = (req.baseUrl || '') + req.route.path;
    return base || req.path;
  }
  return req.path || req.url || 'unknown';
}
