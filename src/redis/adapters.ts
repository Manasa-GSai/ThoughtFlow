import { RefreshTokenRecord, TokenStore, RateLimiterStore } from '../auth';
import type { SessionHelper } from './session-helper';

/**
 * Adapter implementing WO-007's TokenStore interface against the WO-004
 * SessionHelper. This is the production wiring — drops directly into
 * createApp() so AuthService stops talking to InMemoryTokenStore.
 *
 * Implementation notes:
 *   - The Redis session helper stores tokens keyed by (user_id, token_id),
 *     so this adapter must remember the user_id for each token_id it gets
 *     asked about. WO-007's TokenStore.get(token_id) doesn't take a user_id,
 *     so we maintain a small token_id → user_id index keyed by jti.
 *   - Storing the index inside Redis itself would couple us to Redis layout
 *     for a one-line lookup; we keep it in-memory since the AuthService
 *     always knows the user_id when it persists a token in the first place,
 *     and the adapter is the only consumer.
 */
export class RedisTokenStore implements TokenStore {
  private readonly id_to_user = new Map<string, { user_id: string; expires_at: Date }>();

  constructor(private readonly sessions: SessionHelper) {}

  async put(record: RefreshTokenRecord): Promise<void> {
    const ttl = Math.max(1, Math.floor((record.expires_at.getTime() - Date.now()) / 1000));
    await this.sessions.storeRefreshToken(record.user_id, record.token_id, ttl);
    this.id_to_user.set(record.token_id, {
      user_id: record.user_id,
      expires_at: record.expires_at,
    });
  }

  async get(token_id: string): Promise<RefreshTokenRecord | null> {
    const index = this.id_to_user.get(token_id);
    if (!index) return null;
    if (index.expires_at.getTime() <= Date.now()) {
      this.id_to_user.delete(token_id);
      return null;
    }
    const value = await this.sessions.getRefreshToken(index.user_id, token_id);
    if (!value) {
      this.id_to_user.delete(token_id);
      return null;
    }
    return {
      token_id,
      user_id: index.user_id,
      expires_at: index.expires_at,
    };
  }

  async revoke(token_id: string): Promise<void> {
    const index = this.id_to_user.get(token_id);
    if (!index) return;
    await this.sessions.revokeRefreshToken(index.user_id, token_id);
    this.id_to_user.delete(token_id);
  }

  async revokeAllForUser(user_id: string): Promise<void> {
    await this.sessions.revokeAllForUser(user_id);
    for (const [tid, idx] of this.id_to_user.entries()) {
      if (idx.user_id === user_id) this.id_to_user.delete(tid);
    }
  }
}

/**
 * Adapter implementing WO-007's RateLimiterStore against a generic Redis
 * INCR + EXPIRE pattern. This is a SIMPLER fixed-window counter — the
 * auth-endpoint rate limiter only needs "5 attempts per minute per IP" and
 * the boundary inaccuracy of fixed-window is acceptable for short windows
 * (a 5-minute attack burst is still bounded by ~2× max attempts).
 *
 * The richer sliding-window RateLimitHelper is used for tier-aware capture/
 * API limits (BR-1, BR-9) where accuracy matters more.
 */
import type Redis from 'ioredis';

export class RedisRateLimiterStore implements RateLimiterStore {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, window_ms: number): Promise<number> {
    const count = await this.redis.incr(`auth_rl:${key}`);
    if (count === 1) {
      await this.redis.pexpire(`auth_rl:${key}`, window_ms);
    }
    return count;
  }
}
