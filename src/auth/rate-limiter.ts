import { Request, Response, NextFunction } from 'express';

/**
 * Fixed-window IP-based rate limiter for the auth endpoints.
 *
 * Storage is in-memory by design for this WO — WO-010 will replace it with
 * a Redis-backed sliding window when WO-004 lands. The interface lets us
 * swap implementations without changing routes.
 *
 * Per AC #8:
 *   - login:    5 attempts / minute / IP
 *   - register: 3 attempts / minute / IP
 *
 * Tracks BOTH success and failure attempts — preventing burst-credential-
 * stuffing matters more than blocking a few legitimate-but-fast retries.
 */
export interface RateLimiterStore {
  /** Returns the new count after incrementing. */
  hit(key: string, window_ms: number): Promise<number>;
}

export class InMemoryRateLimiterStore implements RateLimiterStore {
  private readonly windows = new Map<string, { count: number; reset_at: number }>();

  async hit(key: string, window_ms: number): Promise<number> {
    const now = Date.now();
    const entry = this.windows.get(key);
    if (!entry || entry.reset_at <= now) {
      this.windows.set(key, { count: 1, reset_at: now + window_ms });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}

export interface RateLimitOptions {
  store: RateLimiterStore;
  /** Unique tag distinguishing this limiter's buckets from others using the same store. */
  scope: string;
  max: number;
  window_ms: number;
  /** Resolves the rate-limit key from a request. Defaults to client IP. */
  keyFn?: (req: Request) => string;
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  const keyFn = options.keyFn ?? defaultKeyFn;
  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const key = `${options.scope}:${keyFn(req)}`;
    const count = await options.store.hit(key, options.window_ms);
    if (count > options.max) {
      const retry_after = Math.ceil(options.window_ms / 1000);
      res.setHeader('Retry-After', String(retry_after));
      res.status(429).json({
        error: 'rate_limited',
        retry_after_seconds: retry_after,
      });
      return;
    }
    next();
  };
}

function defaultKeyFn(req: Request): string {
  // Express sets req.ip from socket.remoteAddress (or from X-Forwarded-For if
  // trust proxy is configured). Fallback to a constant for completeness so
  // an unset req.ip can still hit the limiter rather than bypass it.
  return req.ip ?? 'unknown';
}
