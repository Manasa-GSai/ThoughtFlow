import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runWithCorrelation } from '../logger/correlation';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Generates (or reuses) a correlation ID per request, propagates it to all
 * downstream handlers via AsyncLocalStorage, and echoes it back to the client
 * via the X-Correlation-ID response header so callers can include it in
 * support tickets.
 *
 * If the incoming request includes X-Correlation-ID, that value is used
 * verbatim — this lets upstream gateways or test harnesses pin a trace id.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(CORRELATION_HEADER);
  const correlation_id = incoming && incoming.trim().length > 0 ? incoming.trim() : uuidv4();

  res.setHeader('X-Correlation-ID', correlation_id);

  runWithCorrelation({ correlation_id }, () => {
    next();
  });
}
