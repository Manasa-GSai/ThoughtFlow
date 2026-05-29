import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { AccessTokenClaims, RefreshTokenClaims } from './types';

/**
 * JWT issue/verify wrapper. Configurable expiry per token type:
 *   - Access tokens: 15 minutes (limits exposure if a token leaks via XSS/logs)
 *   - Refresh tokens: 7 days (stored in httpOnly cookie + server-side allowlist)
 *
 * Architecture mandates HS256 with a strong shared secret stored in the secrets
 * manager (WO-047 manages production secrets). Asymmetric signing (RS256) is a
 * future hardening if we federate verification to other services.
 */
export interface JwtConfig {
  access_token_secret: string;
  refresh_token_secret: string;
  access_token_ttl_seconds?: number;
  refresh_token_ttl_seconds?: number;
  /** Optional clock injection for tests. */
  now?: () => number;
}

export const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
export const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export class JwtService {
  private readonly access_secret: string;
  private readonly refresh_secret: string;
  private readonly access_ttl: number;
  private readonly refresh_ttl: number;
  private readonly now: () => number;

  constructor(config: JwtConfig) {
    if (!config.access_token_secret || !config.refresh_token_secret) {
      throw new Error('JwtService requires access_token_secret and refresh_token_secret');
    }
    this.access_secret = config.access_token_secret;
    this.refresh_secret = config.refresh_token_secret;
    this.access_ttl = config.access_token_ttl_seconds ?? DEFAULT_ACCESS_TTL_SECONDS;
    this.refresh_ttl = config.refresh_token_ttl_seconds ?? DEFAULT_REFRESH_TTL_SECONDS;
    this.now = config.now ?? Date.now;
  }

  get accessTtlSeconds(): number {
    return this.access_ttl;
  }

  get refreshTtlSeconds(): number {
    return this.refresh_ttl;
  }

  signAccess(claims: AccessTokenClaims): { token: string; expires_at: number } {
    const iat = Math.floor(this.now() / 1000);
    const exp = iat + this.access_ttl;
    const payload: AccessTokenClaims = { ...claims, iat, exp };
    const options: SignOptions = { algorithm: 'HS256' };
    const token = jwt.sign(payload, this.access_secret, options);
    return { token, expires_at: exp };
  }

  signRefresh(claims: RefreshTokenClaims): { token: string; expires_at: number } {
    const iat = Math.floor(this.now() / 1000);
    const exp = iat + this.refresh_ttl;
    const payload: RefreshTokenClaims = { ...claims, iat, exp };
    const options: SignOptions = { algorithm: 'HS256' };
    const token = jwt.sign(payload, this.refresh_secret, options);
    return { token, expires_at: exp };
  }

  /** Returns claims on success; throws on invalid/expired/wrong-secret. */
  verifyAccess(token: string): AccessTokenClaims {
    const decoded = jwt.verify(token, this.access_secret, {
      algorithms: ['HS256'],
    }) as JwtPayload & AccessTokenClaims;
    return decoded;
  }

  verifyRefresh(token: string): RefreshTokenClaims {
    const decoded = jwt.verify(token, this.refresh_secret, {
      algorithms: ['HS256'],
    }) as JwtPayload & RefreshTokenClaims;
    return decoded;
  }
}
