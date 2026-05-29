import RedisMock from "ioredis-mock";
import { createSessionStore } from "../sessions";

describe("SessionStore", () => {
  let redis: InstanceType<typeof RedisMock>;
  let sessionStore: ReturnType<typeof createSessionStore>;

  beforeEach(() => {
    redis = new RedisMock();
    sessionStore = createSessionStore(redis as any);
  });

  afterEach(async () => {
    await redis.flushall();
    redis.disconnect();
  });

  describe("storeRefreshToken", () => {
    it("stores a refresh token with default 7-day TTL", async () => {
      await sessionStore.storeRefreshToken("user-1", "token-abc");
      const stored = await redis.get("session:refresh:user-1");
      expect(stored).toBe("token-abc");
    });

    it("stores a refresh token with custom TTL", async () => {
      await sessionStore.storeRefreshToken("user-1", "token-abc", 3600);
      const ttl = await redis.ttl("session:refresh:user-1");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);
    });

    it("overwrites existing token for same user", async () => {
      await sessionStore.storeRefreshToken("user-1", "token-1");
      await sessionStore.storeRefreshToken("user-1", "token-2");
      const stored = await redis.get("session:refresh:user-1");
      expect(stored).toBe("token-2");
    });
  });

  describe("getRefreshToken", () => {
    it("retrieves a stored refresh token", async () => {
      await redis.set("session:refresh:user-1", "token-abc");
      const token = await sessionStore.getRefreshToken("user-1");
      expect(token).toBe("token-abc");
    });

    it("returns null for non-existent token", async () => {
      const token = await sessionStore.getRefreshToken("non-existent");
      expect(token).toBeNull();
    });
  });

  describe("revokeRefreshToken", () => {
    it("deletes the stored refresh token", async () => {
      await redis.set("session:refresh:user-1", "token-abc");
      await sessionStore.revokeRefreshToken("user-1");
      const token = await redis.get("session:refresh:user-1");
      expect(token).toBeNull();
    });

    it("does not throw when revoking non-existent token", async () => {
      await expect(
        sessionStore.revokeRefreshToken("non-existent")
      ).resolves.not.toThrow();
    });
  });
});
