import Redis from "ioredis";
import { getRedisClient, isRedisConnected } from "./client";

export type UserTier = "free" | "pro" | "enterprise";
export type RateLimitAction = "capture" | "api_call";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS: Record<UserTier, Record<RateLimitAction, RateLimitConfig | null>> = {
  free: {
    capture: { maxRequests: 20, windowMs: 24 * 60 * 60 * 1000 },
    api_call: { maxRequests: 30, windowMs: 60 * 1000 },
  },
  pro: {
    capture: null, // unlimited
    api_call: { maxRequests: 100, windowMs: 60 * 1000 },
  },
  enterprise: {
    capture: null, // unlimited
    api_call: { maxRequests: 100, windowMs: 60 * 1000 },
  },
};

const RATE_LIMIT_PREFIX = "ratelimit:";

// In-memory fallback store
const memoryStore = new Map<string, { count: number; resetAt: number }>();

const cleanupMemoryStore = (): void => {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.resetAt <= now) {
      memoryStore.delete(key);
    }
  }
};

const checkRateLimitInMemory = (
  userId: string,
  tier: UserTier,
  action: RateLimitAction
): RateLimitResult => {
  const config = RATE_LIMITS[tier][action];
  if (!config) {
    return { allowed: true, remaining: Infinity, resetAt: 0 };
  }

  const key = `${userId}:${action}`;
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.resetAt <= now) {
    const resetAt = now + config.windowMs;
    memoryStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
};

export interface RateLimiter {
  checkRateLimit(
    userId: string,
    tier: UserTier,
    action: RateLimitAction
  ): Promise<RateLimitResult>;
  resetRateLimit(userId: string, action: RateLimitAction): Promise<void>;
}

export const createRateLimiter = (redisClient?: Redis): RateLimiter => {
  const client = redisClient || getRedisClient();

  // Periodic in-memory cleanup
  setInterval(cleanupMemoryStore, 60000).unref();

  return {
    async checkRateLimit(
      userId: string,
      tier: UserTier,
      action: RateLimitAction
    ): Promise<RateLimitResult> {
      const config = RATE_LIMITS[tier][action];
      if (!config) {
        return { allowed: true, remaining: Infinity, resetAt: 0 };
      }

      if (!isRedisConnected()) {
        console.warn(
          "[RateLimiter] Redis unavailable, using in-memory fallback"
        );
        return checkRateLimitInMemory(userId, tier, action);
      }

      const key = `${RATE_LIMIT_PREFIX}${userId}:${action}`;
      const now = Date.now();
      const windowStart = now - config.windowMs;

      try {
        const pipeline = client.pipeline();
        // Remove expired entries
        pipeline.zremrangebyscore(key, 0, windowStart);
        // Count entries in current window
        pipeline.zcard(key);
        // Add current request
        pipeline.zadd(key, now.toString(), `${now}:${Math.random()}`);
        // Set expiry on the key
        pipeline.pexpire(key, config.windowMs);

        const results = await pipeline.exec();

        if (!results) {
          return checkRateLimitInMemory(userId, tier, action);
        }

        const currentCount = (results[1]?.[1] as number) || 0;
        const allowed = currentCount < config.maxRequests;
        const remaining = Math.max(0, config.maxRequests - currentCount - (allowed ? 1 : 0));
        const resetAt = now + config.windowMs;

        if (!allowed) {
          // Remove the entry we just added since request is denied
          const lastResult = results[2];
          if (lastResult) {
            await client.zremrangebyscore(key, now, now);
          }
        }

        return { allowed, remaining, resetAt };
      } catch (error) {
        console.warn(
          "[RateLimiter] Redis error, falling back to in-memory:",
          (error as Error).message
        );
        return checkRateLimitInMemory(userId, tier, action);
      }
    },

    async resetRateLimit(
      userId: string,
      action: RateLimitAction
    ): Promise<void> {
      const key = `${RATE_LIMIT_PREFIX}${userId}:${action}`;
      try {
        await client.del(key);
      } catch {
        // Silent fail on reset
      }
      memoryStore.delete(`${userId}:${action}`);
    },
  };
};

export { RATE_LIMITS, checkRateLimitInMemory, memoryStore };
