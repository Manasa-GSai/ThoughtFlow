import { randomUUID } from 'node:crypto';
import { JwtService } from '../jwt-service';
import { TokenStore } from '../token-store';
import { UserStore } from '../user-store';
import {
  AuthSuccessResponse,
  AuthenticatedUser,
  OAuthProvider,
  RefreshTokenRecord,
  User,
} from '../types';
import { OAuthProfile } from './provider';

export interface OAuthServiceDeps {
  userStore: UserStore;
  tokenStore: TokenStore;
  jwtService: JwtService;
}

export interface OAuthSignInResult {
  response: AuthSuccessResponse;
  refresh_token: string;
  refresh_expires_at: number;
  /** Whether the user was newly created during this sign-in. */
  is_new_user: boolean;
  /** Whether an existing password-only account was linked to this provider. */
  linked_existing: boolean;
}

/**
 * Account-resolution policy (AC #5, #6):
 *
 *   1. Look up by (provider, oauth_id) — fast path for returning users
 *      who've signed in with this provider before. Returns existing user.
 *
 *   2. Else look up by email:
 *      a. If found AND the user already has a different oauth_provider:
 *         throw — refuse to silently overwrite a prior OAuth identity. This
 *         prevents an attacker who controls a Google account with the same
 *         email as another user's Apple identity from hijacking the account.
 *      b. If found and no oauth_provider yet → link (set oauth_provider +
 *         oauth_id on the existing record).
 *
 *   3. Else create a new OAuth user (no password).
 *
 * Returns a normal AuthSuccessResponse with access + refresh tokens, identical
 * to the email/password sign-in flow.
 */
export class OAuthAccountConflictError extends Error {
  constructor(email: string) {
    super(
      `Account ${email} already linked to a different OAuth provider. Sign in with that provider instead.`,
    );
    this.name = 'OAuthAccountConflictError';
  }
}

export class OAuthService {
  constructor(private readonly deps: OAuthServiceDeps) {}

  async signIn(profile: OAuthProfile): Promise<OAuthSignInResult> {
    // 1. Fast path — direct OAuth identity lookup
    const existing_by_oauth = await this.deps.userStore.findByOAuth(
      profile.provider,
      profile.oauth_id,
    );
    if (existing_by_oauth) {
      const result = await this.issueTokenPair(existing_by_oauth);
      return { ...result, is_new_user: false, linked_existing: false };
    }

    // 2. Email lookup — link or reject
    const existing_by_email = await this.deps.userStore.findByEmail(profile.email);
    if (existing_by_email) {
      if (existing_by_email.oauth_provider && existing_by_email.oauth_provider !== profile.provider) {
        throw new OAuthAccountConflictError(profile.email);
      }
      // Snapshot the prior oauth_provider BEFORE linking — linkOAuth mutates
      // the user object in place (in-memory impl), so reading it after the
      // call would always see the new value and `linked_existing` would
      // never report true.
      const had_no_prior_oauth = !existing_by_email.oauth_provider;
      const linked = await this.deps.userStore.linkOAuth(
        existing_by_email.id,
        profile.provider,
        profile.oauth_id,
      );
      const result = await this.issueTokenPair(linked);
      return {
        ...result,
        is_new_user: false,
        linked_existing: had_no_prior_oauth,
      };
    }

    // 3. Create new OAuth user
    const user = await this.deps.userStore.createOAuth({
      email: profile.email,
      display_name: profile.display_name,
      provider: profile.provider,
      oauth_id: profile.oauth_id,
    });
    const result = await this.issueTokenPair(user);
    return { ...result, is_new_user: true, linked_existing: false };
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
    const refresh = this.deps.jwtService.signRefresh({ sub: user.id, jti: token_id });
    const record: RefreshTokenRecord = {
      token_id,
      user_id: user.id,
      expires_at: new Date(refresh.expires_at * 1000),
    };
    await this.deps.tokenStore.put(record);
    const authed: AuthenticatedUser = { id: user.id, email: user.email, tier: user.tier };
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

// Re-export the unused-but-relevant provider type so callers have one import path
export type { OAuthProvider };
