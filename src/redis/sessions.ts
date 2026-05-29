import Redis from "ioredis";
import { getRedisClient } from "./client";

const SESSION_PREFIX = "session:refresh:";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionStore {
  storeRefreshToken(
    userId: string,
    token: string,
    ttlSeconds?: number
  ): Promise<void>;
  getRefreshToken(userId: string): Promise<string | null>;
  revokeRefreshToken(userId: string): Promise<void>;
}

export const createSessionStore = (redisClient?: Redis): SessionStore => {
  const client = redisClient || getRedisClient();

  return {
    async storeRefreshToken(
      userId: string,
      token: string,
      ttlSeconds: number = DEFAULT_TTL_SECONDS
    ): Promise<void> {
      const key = `${SESSION_PREFIX}${userId}`;
      await client.set(key, token, "EX", ttlSeconds);
    },

    async getRefreshToken(userId: string): Promise<string | null> {
      const key = `${SESSION_PREFIX}${userId}`;
      return client.get(key);
    },

    async revokeRefreshToken(userId: string): Promise<void> {
      const key = `${SESSION_PREFIX}${userId}`;
      await client.del(key);
    },
  };
};
