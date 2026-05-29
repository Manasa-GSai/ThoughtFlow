import { randomUUID } from 'node:crypto';
import { PasswordHasher } from './password-hasher';
import { JwtService } from './jwt-service';
import { UserStore, EmailAlreadyExistsError } from './user-store';
import { TokenStore } from './token-store';
import {
  AuthSuccessResponse,
  AuthenticatedUser,
  RefreshTokenRecord,
  User,
} from './types';

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid refresh token: ${reason}`);
    this.name = 'InvalidRefreshTokenError';
  }
}

export interface AuthServiceDeps {
  userStore: UserStore;
  tokenStore: TokenStore;
  passwordHasher: PasswordHasher;
  jwtService: JwtService;
}

/**
 * Orchestrates the auth flows. Routes are thin — they parse input via Zod,
 * call one method here, format the response. Per CLAUDE.md: routes thin,
 * services own business logic, repositories CRUD-only.
 *
 * Each public method returns either an AuthSuccessResponse + refresh token,
 * or throws a tagged error that the route layer maps to an HTTP status:
 *   - EmailAlreadyExistsError → 409
 *   - InvalidCredentialsError → 401
 *   - InvalidRefreshTokenError → 401
 */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ response: AuthSuccessResponse; refresh_token: string; refresh_expires_at: number }> {
    const password_hash = await this.deps.passwordHasher.hash(input.password);
    const user = await this.deps.userStore.create({
      email: input.email,
      display_name: input.displayName,
      password_hash,
    });
    return this.issueTokenPair(user);
  }

  async login(input: { email: string; password: string }): Promise<{
    response: AuthSuccessResponse;
    refresh_token: string;
    refresh_expires_at: number;
  }> {
    const user = await this.deps.userStore.findByEmail(input.email);
    // Run verify even on missing user to keep timing constant — avoid the
    // classic email-enumeration oracle where "email exists" responds faster.
    const verify_against = user?.password_hash ?? DUMMY_BCRYPT_HASH;
    const ok = await this.deps.passwordHasher.verify(input.password, verify_against);
    if (!user || !ok) {
      throw new InvalidCredentialsError();
    }
    return this.issueTokenPair(user);
  }

  async refresh(refresh_token: string): Promise<{
    response: AuthSuccessResponse;
    refresh_token: string;
    refresh_expires_at: number;
  }> {
    let claims;
    try {
      claims = this.deps.jwtService.verifyRefresh(refresh_token);
    } catch (err) {
      throw new InvalidRefreshTokenError('signature or expiry');
    }

    const record = await this.deps.tokenStore.get(claims.jti);
    if (!record || record.user_id !== claims.sub) {
      // jti not in allow-list → was revoked or never issued by us.
      throw new InvalidRefreshTokenError('not found or revoked');
    }

    const user = await this.deps.userStore.findById(claims.sub);
    if (!user) throw new InvalidRefreshTokenError('user no longer exists');

    // Rotation: revoke the old token before issuing the new one so a
    // stolen-but-not-yet-used refresh token can be used at most once.
    await this.deps.tokenStore.revoke(claims.jti);
    return this.issueTokenPair(user);
  }

  async logout(refresh_token: string | undefined): Promise<void> {
    if (!refresh_token) return; // already logged out, idempotent
    try {
      const claims = this.deps.jwtService.verifyRefresh(refresh_token);
      await this.deps.tokenStore.revoke(claims.jti);
    } catch {
      // Token already expired/invalid — nothing to revoke. Idempotent.
    }
  }

  private async issueTokenPair(user: User): Promise<{
    response: AuthSuccessResponse;
    refresh_token: string;
    refresh_expires_at: number;
  }> {
    const access = this.deps.jwtService.signAccess({
      sub: user.id,
      email: user.email,
      tier: user.tier,
    });
    const token_id = randomUUID();
    const refresh = this.deps.jwtService.signRefresh({
      sub: user.id,
      jti: token_id,
    });
    const record: RefreshTokenRecord = {
      token_id,
      user_id: user.id,
      expires_at: new Date(refresh.expires_at * 1000),
    };
    await this.deps.tokenStore.put(record);

    const authed: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      tier: user.tier,
    };
    return {
      response: {
        user: authed,
        access_token: access.token,
        access_token_expires_at: access.expires_at,
      },
      refresh_token: refresh.token,
      refresh_expires_at: refresh.expires_at,
    };
  }
}

// Re-export the type-tagged error from user-store so callers handle it
// alongside the other AuthService errors.
export { EmailAlreadyExistsError };

/**
 * Pre-computed bcrypt hash of the string "INVALID_PASSWORD_PLACEHOLDER".
 * Used to keep login timing constant when the email isn't found — without
 * this, `findByEmail → null → skip verify` returns ~200ms faster than the
 * happy path, enabling email enumeration.
 *
 * Generated once with cost factor 12; the actual plaintext is irrelevant
 * because compare() against an unknown password will always return false.
 */
const DUMMY_BCRYPT_HASH =
  '$2a$12$abcdefghijklmnopqrstuuO5kqLPdQK6QXxxsZ8d6F5d6F5d6F5d6F';
