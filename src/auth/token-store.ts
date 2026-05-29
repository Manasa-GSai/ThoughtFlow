import { RefreshTokenRecord } from './types';

/**
 * Server-side store of active refresh tokens, keyed by the opaque token_id
 * (jti claim). Required so logout and refresh can REVOKE prior tokens —
 * pure-JWT auth has no revocation story.
 *
 * Real impl lands with WO-004 (Redis with TTL = token expiry). For now,
 * InMemoryTokenStore is used in dev/tests.
 *
 * Tokens MUST be expired-out automatically by the underlying store
 * (Redis EXPIRE) so we don't accumulate stale records over time.
 */
export interface TokenStore {
  /** Persist a refresh token; ignores any existing record with the same id. */
  put(record: RefreshTokenRecord): Promise<void>;
  /** Return the record if still active (not revoked, not expired), else null. */
  get(token_id: string): Promise<RefreshTokenRecord | null>;
  /** Revoke a single refresh token. Idempotent. */
  revoke(token_id: string): Promise<void>;
  /** Revoke all refresh tokens for a user — used on password change (future WO). */
  revokeAllForUser(user_id: string): Promise<void>;
}

/**
 * In-memory implementation suitable for development and unit tests.
 * Production runs against Redis (WO-004).
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, RefreshTokenRecord>();

  async put(record: RefreshTokenRecord): Promise<void> {
    this.tokens.set(record.token_id, record);
  }

  async get(token_id: string): Promise<RefreshTokenRecord | null> {
    const record = this.tokens.get(token_id);
    if (!record) return null;
    if (record.expires_at.getTime() <= Date.now()) {
      this.tokens.delete(token_id);
      return null;
    }
    return record;
  }

  async revoke(token_id: string): Promise<void> {
    this.tokens.delete(token_id);
  }

  async revokeAllForUser(user_id: string): Promise<void> {
    for (const [id, record] of this.tokens.entries()) {
      if (record.user_id === user_id) this.tokens.delete(id);
    }
  }
}
