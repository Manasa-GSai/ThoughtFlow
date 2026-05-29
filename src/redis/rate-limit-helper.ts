import type Redis from 'ioredis';
import type { UserTier } from '../auth';

/**
 * Tier-aware sliding-window rate limiter (AC #4, #5, #6).
 *
 * Limits per BRD BR-1, BR-9 and architecture:
 *   - Free: 20 captures/day (rolling 24h), 30 API calls/min
 *   - Pro:  unlimited captures, 100 API calls/min
 *   - Enterprise: same as Pro for now (architecture doesn't differentiate yet)
 *
 * Algorithm: sliding window via Redis sorted set. Each request's timestamp
 * is ZADD'd at score=now; we ZREMRANGEBYSCORE entries older than (now - window)
 * and ZCARD to get the count. This is more accurate than a fixed-window counter
 * (no boundary bursts) and cheaper than a leaky bucket per-key.
 *
 * Use of MULTI batches the four ops into one round-trip; the `EXPIRE` is set
 * to the window length so abandoned keys are reclaimed automatically (Redis
 * TTL handles GC — we never need a sweeper).
 */
export type RateLimitAction = 'capture' | 'api';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch milliseconds when the limit fully resets. */
  reset_at: number;
  /** The applicable limit at decision time (useful for X-RateLimit-Limit header). */
  limit: number;
}

export interface TierLimits {
  capture: { max: number; window_ms: number };
  api: { max: number; window_ms: number };
}

export const TIER_LIMITS: Record<UserTier, TierLimits> = {
  free: {
    capture: { max: 20, window_ms: 24 * 60 * 60 * 1000 }, // 20 / 24h
    api: { max: 30, window_ms: 60 * 1000 }, // 30 / 60s
  },
  pro: {
    capture: { max: Number.POSITIVE_INFINITY, window_ms: 24 * 60 * 60 * 1000 },
    api: { max: 100, window_ms: 60 * 1000 },
  },
  enterprise: {
    capture: { max: Number.POSITIVE_INFINITY, window_ms: 24 * 60 * 60 * 1000 },
    api: { max: 100, window_ms: 60 * 1000 },
  },
};

const KEY_PREFIX = 'ratelimit';

function rateLimitKey(user_id: string, action: RateLimitAction): string {
  return `${KEY_PREFIX}:${action}:${user_id}`;
}

export interface RateLimitHelper {
  checkRateLimit(user_id: string, tier: UserTier, action: RateLimitAction): Promise<RateLimitResult>;
  /** Tests inject a fixed clock; production uses Date.now. */
  now?: () => number;
}

export class RedisRateLimitHelper implements RateLimitHelper {
  constructor(private readonly redis: Redis, public readonly now: () => number = Date.now) {}

  async checkRateLimit(
    user_id: string,
    tier: UserTier,
    action: RateLimitAction,
  ): Promise<RateLimitResult> {
    const limit = TIER_LIMITS[tier][action];
    const t = this.now();

    // Unlimited fast-path — Pro/Enterprise capture
    if (limit.max === Number.POSITIVE_INFINITY) {
      return {
        allowed: true,
        remaining: Number.POSITIVE_INFINITY,
        reset_at: t + limit.window_ms,
        limit: Number.POSITIVE_INFINITY,
      };
    }

    const key = rateLimitKey(user_id, action);
    const window_start = t - limit.window_ms;
    const member = `${t}-${Math.random().toString(36).slice(2, 8)}`;

    // Sliding-window via sorted set:
    //   1. Drop entries older than the window.
    //   2. Insert the current request stamped at `t`.
    //   3. Read the count.
    //   4. Refresh the TTL so abandoned keys self-clean.
    const tx = this.redis.multi();
    tx.zremrangebyscore(key, 0, window_start);
    tx.zadd(key, t, member);
    tx.zcard(key);
    tx.pexpire(key, limit.window_ms);
    const results = await tx.exec();

    // If MULTI returned null, the transaction was aborted (extremely rare —
    // would only happen on WATCH conflicts, which we don't use).
    if (!results) {
      throw new Error('Redis rate-limit transaction returned no results');
    }
    const count_result = results[2];
    if (!count_result || count_result[0]) {
      throw new Error(`Redis rate-limit ZCARD failed: ${count_result?.[0]?.message ?? 'unknown'}`);
    }
    const count = Number(count_result[1]);

    const allowed = count <= limit.max;
    if (!allowed) {
      // We added the rejected request to the ZSET above — back it out so a
      // run of rejections doesn't permanently inflate the count beyond the limit.
      await this.redis.zrem(key, member);
    }

    return {
      allowed,
      remaining: Math.max(0, limit.max - count),
      reset_at: t + limit.window_ms,
      limit: limit.max,
    };
  }
}
