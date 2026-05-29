import { Request, Response, NextFunction } from 'express';
import { RateLimitAction, RateLimitHelper, RateLimitResult } from '../redis';

/**
 * Tier-aware API rate-limit middleware (WO-010).
 *
 * Reads the authenticated user from req.user (populated by requireAuth) and
 * consults the RateLimitHelper. Sets X-RateLimit-{Limit,Remaining,Reset} on
 * every response so the frontend can show "you have N captures left today"
 * (AC #5). When the limit is exceeded, responds 429 with a structured body
 * and Retry-After header (AC #6).
 *
 * Skip rules:
 *   - No req.user (e.g., requests to /api/auth/*): the middleware short-
 *     circuits. Auth endpoints have their own IP-based limiter from WO-007.
 *   - Unlimited tier×action combinations (Pro capture = ∞): the limit/reset
 *     headers are still set, with Infinity rendered as the string 'unlimited'
 *     for client friendliness.
 */
export interface TierRateLimitOptions {
  rateLimitHelper: RateLimitHelper;
  action: RateLimitAction;
  /**
   * Custom message for the 429 body. Default matches AC #2 for captures.
   */
  exceededMessage?: string;
}

export function createTierRateLimitMiddleware(options: TierRateLimitOptions) {
  return async function tierRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = req.user;
    if (!user) {
      // No authenticated user — let it through; auth-endpoint limiter handles
      // the unauthenticated case via WO-007's IP-based limiter.
      next();
      return;
    }

    let result: RateLimitResult;
    try {
      result = await options.rateLimitHelper.checkRateLimit(user.id, user.tier, options.action);
    } catch (err) {
      // Fail open on rate-limiter errors so a brief Redis outage doesn't
      // 500 the whole API. Operators will see the error in metrics + logs.
      next(err);
      return;
    }

    setRateLimitHeaders(res, result);

    if (!result.allowed) {
      const retry_after_seconds = Math.max(1, Math.ceil((result.reset_at - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retry_after_seconds));
      res.status(429).json({
        error:
          options.exceededMessage ??
          (options.action === 'capture'
            ? 'Daily capture limit reached'
            : 'Too many requests'),
        limit: numericForBody(result.limit),
        remaining: 0,
        reset_at: new Date(result.reset_at).toISOString(),
      });
      return;
    }

    next();
  };
}

function setRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.setHeader('X-RateLimit-Limit', renderLimit(result.limit));
  res.setHeader('X-RateLimit-Remaining', renderLimit(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(result.reset_at / 1000)));
}

function renderLimit(value: number): string {
  return value === Number.POSITIVE_INFINITY ? 'unlimited' : String(value);
}

/** Numeric-or-null payload representation for limit/remaining in JSON bodies. */
function numericForBody(value: number): number | null {
  return value === Number.POSITIVE_INFINITY ? null : value;
}
