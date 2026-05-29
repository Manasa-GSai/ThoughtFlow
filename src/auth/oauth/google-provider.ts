import {
  OAuthProviderClient,
  OAuthProfile,
  OAuthConfigError,
  OAuthExchangeError,
} from './provider';
import { decodeAndValidateIdToken } from './id-token';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUER = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleProviderConfig {
  client_id: string;
  client_secret: string;
  /** Optional injected fetch for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Google OAuth 2.0 / OIDC. Flow:
 *   1. Browser → /api/auth/google → 302 to authorizationUrl()
 *   2. User consents → Google redirects to /api/auth/google/callback?code=...&state=...
 *   3. Router calls exchangeCode(code) → POST to token endpoint with grant_type=authorization_code
 *   4. Token response contains id_token (JWT) — decode + validate iss/aud/exp
 *   5. Return normalized OAuthProfile
 */
export class GoogleProviderClient implements OAuthProviderClient {
  readonly name = 'google' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GoogleProviderConfig) {
    if (!config.client_id || !config.client_secret) {
      throw new OAuthConfigError('GoogleProvider requires client_id and client_secret');
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  authorizationUrl(state: string, redirect_uri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.client_id,
      redirect_uri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirect_uri: string): Promise<OAuthProfile> {
    const body = new URLSearchParams({
      code,
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
      redirect_uri,
      grant_type: 'authorization_code',
    });

    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new OAuthExchangeError(
        `Google token exchange failed (${response.status}): ${text.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as { id_token?: string };
    if (!payload.id_token) {
      throw new OAuthExchangeError('Google token response missing id_token');
    }

    const claims = decodeAndValidateIdToken(payload.id_token, {
      expected_iss: GOOGLE_ISSUER,
      expected_aud: this.config.client_id,
    });

    return {
      provider: 'google',
      oauth_id: claims.sub,
      email: claims.email!,
      display_name: typeof claims.name === 'string' && claims.name.trim().length > 0
        ? claims.name
        : claims.email!.split('@')[0],
    };
  }
}
