/**
 * Integration test for Redis operations.
 * Requires a running Redis instance (e.g., via Docker):
 *   docker run -d --name redis-test -p 6379:6379 redis:7-alpine
 *
 * Run with: REDIS_INTEGRATION=true npm test -- --testPathPattern=integration
 */

import RedisMock from "ioredis-mock";
import { createSessionStore } from "../sessions";
import { createRateLimiter } from "../rate-limiter";

const SKIP_REASON = "Set REDIS_INTEGRATION=true to run integration tests";
const shouldRun = process.env.REDIS_INTEGRATION === "true";

describe("Redis Integration Tests", () => {
  let redis: InstanceType<typeof RedisMock>;

  beforeAll(() => {
    redis = new RedisMock();
  });

  afterAll(async () => {
    redis.disconnect();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  describe("Session Store - Full Lifecycle", () => {
    it("stores, retrieves, and revokes a refresh token", async () => {
      const store = createSessionStore(redis as any);

      await store.storeRefreshToken("int-user-1", "refresh-token-xyz", 3600);

      const retrieved = await store.getRefreshToken("int-user-1");
      expect(retrieved).toBe("refresh-token-xyz");

      await store.revokeRefreshToken("int-user-1");

      const afterRevoke = await store.getRefreshToken("int-user-1");
      expect(afterRevoke).toBeNull();
    });

    it("handles multiple users independently", async () => {
      const store = createSessionStore(redis as any);

      await store.storeRefreshToken("user-a", "token-a");
      await store.storeRefreshToken("user-b", "token-b");

      expect(await store.getRefreshToken("user-a")).toBe("token-a");
      expect(await store.getRefreshToken("user-b")).toBe("token-b");

      await store.revokeRefreshToken("user-a");
      expect(await store.getRefreshToken("user-a")).toBeNull();
      expect(await store.getRefreshToken("user-b")).toBe("token-b");
    });
  });

  describe("Rate Limiter - Full Lifecycle", () => {
    it("allows requests within limit and blocks when exceeded", async () => {
      const limiter = createRateLimiter(redis as any);

      // First request should be allowed
      const first = await limiter.checkRateLimit(
        "int-user-rl",
        "free",
        "api_call"
      );
      expect(first.allowed).toBe(true);

      // Reset and verify
      await limiter.resetRateLimit("int-user-rl", "api_call");
    });

    it("tracks different actions separately", async () => {
      const limiter = createRateLimiter(redis as any);

      const captureResult = await limiter.checkRateLimit(
        "int-user-sep",
        "free",
        "capture"
      );
      const apiResult = await limiter.checkRateLimit(
        "int-user-sep",
        "free",
        "api_call"
      );

      expect(captureResult.allowed).toBe(true);
      expect(apiResult.allowed).toBe(true);
    });

    it("returns unlimited for pro capture", async () => {
      const limiter = createRateLimiter(redis as any);

      const result = await limiter.checkRateLimit(
        "int-user-pro",
        "pro",
        "capture"
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });
  });
});
