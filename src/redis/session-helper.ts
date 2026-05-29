import type Redis from 'ioredis';

/**
 * Session helper for refresh-token storage (AC #3).
 *
 * Key shape:  `refresh:{user_id}:{token_id}` → token string
 * TTL:        7 days by default; configurable per-call so admin reissue can override.
 *
 * The token_id (jti) is the JWT claim that identifies a unique refresh-token
 * record. WO-007's AuthService treats the TokenStore allow-list as the canonical
 * source of truth: a JWT signature alone is NOT sufficient to refresh — the
 * server must find the jti in this allow-list. That's what enables logout to
 * actually invalidate tokens (pure JWT has no revocation).
 *
 * The two-part key (`refresh:{user_id}:{token_id}`) supports both:
 *   - O(1) single-token lookup by id
 *   - revokeAllForUser via SCAN over the `refresh:{user_id}:*` prefix
 */
export const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const KEY_PREFIX = 'refresh';

function sessionKey(user_id: string, token_id: string): string {
  return `${KEY_PREFIX}:${user_id}:${token_id}`;
}

export interface SessionHelper {
  storeRefreshToken(user_id: string, token_id: string, ttl_seconds?: number): Promise<void>;
  getRefreshToken(user_id: string, token_id: string): Promise<string | null>;
  revokeRefreshToken(user_id: string, token_id: string): Promise<void>;
  revokeAllForUser(user_id: string): Promise<void>;
}

export class RedisSessionHelper implements SessionHelper {
  constructor(private readonly redis: Redis) {}

  async storeRefreshToken(
    user_id: string,
    token_id: string,
    ttl_seconds: number = DEFAULT_REFRESH_TTL_SECONDS,
  ): Promise<void> {
    await this.redis.set(sessionKey(user_id, token_id), token_id, 'EX', ttl_seconds);
  }

  async getRefreshToken(user_id: string, token_id: string): Promise<string | null> {
    return this.redis.get(sessionKey(user_id, token_id));
  }

  async revokeRefreshToken(user_id: string, token_id: string): Promise<void> {
    await this.redis.del(sessionKey(user_id, token_id));
  }

  async revokeAllForUser(user_id: string): Promise<void> {
    const pattern = `${KEY_PREFIX}:${user_id}:*`;
    const keys: string[] = [];
    let cursor = '0';
    do {
      // SCAN avoids blocking Redis like KEYS would on large datasets.
      const [nextCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    if (keys.length > 0) await this.redis.del(...keys);
  }
}
