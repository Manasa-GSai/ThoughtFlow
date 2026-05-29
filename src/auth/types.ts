/**
 * Tier enum mirrors the BRD's three pricing tiers (Free, Pro, Enterprise).
 * The middleware uses this for tier-gated routes; WO-010 will enforce
 * rate limits per tier.
 */
export type UserTier = 'free' | 'pro' | 'enterprise';

/**
 * OAuth provider identifiers. Apple and Google are the two we support
 * directly per BR-4 / WO-009. Enterprise SSO (SAML/OIDC) is deferred to the
 * Enterprise tier roadmap.
 */
export type OAuthProvider = 'google' | 'apple';

export interface User {
  id: string;
  email: string;
  display_name: string;
  /**
   * Null when the user signed up via OAuth and never set a password. The
   * AuthService.login() path must reject password attempts against such users
   * (the dummy-hash compare in login() will return false because there's
   * nothing to compare).
   */
  password_hash: string | null;
  /** Set when the user signed in via OAuth at least once. */
  oauth_provider?: OAuthProvider;
  /** Provider's unique subject identifier (sub claim of the ID token). */
  oauth_id?: string;
  tier: UserTier;
  created_at: Date;
}

/** Information attached to req.user after auth middleware passes. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  tier: UserTier;
}

/** Persisted refresh-token record (one per active session). */
export interface RefreshTokenRecord {
  /** Opaque token ID (random UUID) — what we sign into the JWT 'jti'. */
  token_id: string;
  user_id: string;
  expires_at: Date;
}

/** Claims signed into the short-lived access token. */
export interface AccessTokenClaims {
  sub: string; // user_id
  email: string;
  tier: UserTier;
  iat?: number;
  exp?: number;
}

/** Claims signed into the refresh token — opaque jti maps to a Redis record. */
export interface RefreshTokenClaims {
  sub: string; // user_id
  jti: string; // token_id (looked up in TokenStore for revocation)
  iat?: number;
  exp?: number;
}

export interface AuthSuccessResponse {
  user: AuthenticatedUser;
  access_token: string;
  /** Expiry (epoch seconds) of the access token so clients can preempt 401s. */
  access_token_expires_at: number;
}
