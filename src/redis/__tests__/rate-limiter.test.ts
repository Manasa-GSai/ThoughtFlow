import {
  checkRateLimitInMemory,
  memoryStore,
  RATE_LIMITS,
} from "../rate-limiter";

describe("RateLimiter - In-Memory Fallback", () => {
  beforeEach(() => {
    memoryStore.clear();
  });

  describe("checkRateLimitInMemory", () => {
    it("allows first request for free tier capture", () => {
      const result = checkRateLimitInMemory("user-1", "free", "capture");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(19);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });

    it("allows first request for free tier api_call", () => {
      const result = checkRateLimitInMemory("user-1", "free", "api_call");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(29);
    });

    it("allows unlimited captures for pro tier", () => {
      const result = checkRateLimitInMemory("user-1", "pro", "capture");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });

    it("enforces 100 API calls/min for pro tier", () => {
      const result = checkRateLimitInMemory("user-1", "pro", "api_call");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
    });

    it("blocks after 20 captures for free tier", () => {
      for (let i = 0; i < 20; i++) {
        checkRateLimitInMemory("user-blocked", "free", "capture");
      }
      const result = checkRateLimitInMemory("user-blocked", "free", "capture");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("blocks after 30 API calls for free tier", () => {
      for (let i = 0; i < 30; i++) {
        checkRateLimitInMemory("user-api", "free", "api_call");
      }
      const result = checkRateLimitInMemory("user-api", "free", "api_call");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("blocks after 100 API calls for pro tier", () => {
      for (let i = 0; i < 100; i++) {
        checkRateLimitInMemory("user-pro", "pro", "api_call");
      }
      const result = checkRateLimitInMemory("user-pro", "pro", "api_call");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("resets after window expires", () => {
      const originalNow = Date.now;
      const fakeNow = Date.now();

      Date.now = () => fakeNow;
      for (let i = 0; i < 20; i++) {
        checkRateLimitInMemory("user-reset", "free", "capture");
      }

      // Move time forward past the 24h window
      Date.now = () => fakeNow + 24 * 60 * 60 * 1000 + 1;
      const result = checkRateLimitInMemory("user-reset", "free", "capture");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(19);

      Date.now = originalNow;
    });

    it("tracks separate limits per user", () => {
      for (let i = 0; i < 20; i++) {
        checkRateLimitInMemory("user-a", "free", "capture");
      }
      const resultA = checkRateLimitInMemory("user-a", "free", "capture");
      const resultB = checkRateLimitInMemory("user-b", "free", "capture");

      expect(resultA.allowed).toBe(false);
      expect(resultB.allowed).toBe(true);
    });

    it("tracks separate limits per action", () => {
      for (let i = 0; i < 20; i++) {
        checkRateLimitInMemory("user-multi", "free", "capture");
      }
      const captureResult = checkRateLimitInMemory(
        "user-multi",
        "free",
        "capture"
      );
      const apiResult = checkRateLimitInMemory(
        "user-multi",
        "free",
        "api_call"
      );

      expect(captureResult.allowed).toBe(false);
      expect(apiResult.allowed).toBe(true);
    });

    it("allows unlimited captures for enterprise tier", () => {
      const result = checkRateLimitInMemory(
        "user-ent",
        "enterprise",
        "capture"
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(Infinity);
    });
  });

  describe("RATE_LIMITS configuration", () => {
    it("free tier has 20 captures/day", () => {
      expect(RATE_LIMITS.free.capture?.maxRequests).toBe(20);
      expect(RATE_LIMITS.free.capture?.windowMs).toBe(24 * 60 * 60 * 1000);
    });

    it("free tier has 30 API calls/minute", () => {
      expect(RATE_LIMITS.free.api_call?.maxRequests).toBe(30);
      expect(RATE_LIMITS.free.api_call?.windowMs).toBe(60 * 1000);
    });

    it("pro tier has unlimited captures", () => {
      expect(RATE_LIMITS.pro.capture).toBeNull();
    });

    it("pro tier has 100 API calls/minute", () => {
      expect(RATE_LIMITS.pro.api_call?.maxRequests).toBe(100);
      expect(RATE_LIMITS.pro.api_call?.windowMs).toBe(60 * 1000);
    });
  });
});
