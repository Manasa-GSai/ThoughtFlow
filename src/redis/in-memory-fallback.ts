import type { SessionHelper } from './session-helper';
import {
  RateLimitAction,
  RateLimitHelper,
  RateLimitResult,
  TIER_LIMITS,
} from './rate-limit-helper';
import type { UserTier } from '../auth';

/**
 * In-memory fallbacks used when Redis is unavailable (AC #7).
 *
 * These have degraded accuracy compared to Redis:
 *   - Sessions are per-process — multi-instance deployments will lose tokens
 *     issued on one pod when the user hits another. Acceptable for short
 *     Redis outages; not a substitute for healthy Redis.
 *   - Rate limit windows are per-process — three pods each allowing 30 req/min
 *     effectively grant 90 req/min. The caller is expected to log a warning
 *     when falling back so operators see the degradation.
 *
 * The interfaces match RedisSessionHelper and RedisRateLimitHelper exactly so
 * createApp can transparently swap implementations.
 */

export class InMemorySessionHelper implements SessionHelper {
  private readonly tokens = new Map<string, { token_id: string; expires_at: number }>();

  private key(user_id: string, token_id: string): string {
    return `${user_id}:${token_id}`;
  }

  async storeRefreshToken(
    user_id: string,
    token_id: string,
    ttl_seconds: number = 7 * 24 * 60 * 60,
  ): Promise<void> {
    this.tokens.set(this.key(user_id, token_id), {
      token_id,
      expires_at: Date.now() + ttl_seconds * 1000,
    });
  }

  async getRefreshToken(user_id: string, token_id: string): Promise<string | null> {
    const entry = this.tokens.get(this.key(user_id, token_id));
    if (!entry) return null;
    if (entry.expires_at <= Date.now()) {
      this.tokens.delete(this.key(user_id, token_id));
      return null;
    }
    return entry.token_id;
  }

  async revokeRefreshToken(user_id: string, token_id: string): Promise<void> {
    this.tokens.delete(this.key(user_id, token_id));
  }

  async revokeAllForUser(user_id: string): Promise<void> {
    const prefix = `${user_id}:`;
    for (const k of this.tokens.keys()) {
      if (k.startsWith(prefix)) this.tokens.delete(k);
    }
  }
}

interface RateBucket {
  /** Timestamps of recorded requests within the rolling window. */
  hits: number[];
}

export class InMemoryRateLimitHelper implements RateLimitHelper {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(public readonly now: () => number = Date.now) {}

  async checkRateLimit(
    user_id: string,
    tier: UserTier,
    action: RateLimitAction,
  ): Promise<RateLimitResult> {
    const limit = TIER_LIMITS[tier][action];
    const t = this.now();

    if (limit.max === Number.POSITIVE_INFINITY) {
      return {
        allowed: true,
        remaining: Number.POSITIVE_INFINITY,
        reset_at: t + limit.window_ms,
        limit: Number.POSITIVE_INFINITY,
      };
    }

    const key = `${action}:${user_id}`;
    const window_start = t - limit.window_ms;
    const bucket = this.buckets.get(key) ?? { hits: [] };
    // Drop entries outside the window
    bucket.hits = bucket.hits.filter((ts) => ts > window_start);
    bucket.hits.push(t);

    const allowed = bucket.hits.length <= limit.max;
    if (!allowed) {
      // Roll back the rejected request so persistent over-limit traffic doesn't
      // permanently inflate `hits` beyond the limit.
      bucket.hits.pop();
    }

    this.buckets.set(key, bucket);
    return {
      allowed,
      remaining: Math.max(0, limit.max - bucket.hits.length),
      reset_at: t + limit.window_ms,
      limit: limit.max,
    };
  }
}
