import {
  OAuthProviderClient,
  OAuthProfile,
  OAuthConfigError,
  OAuthExchangeError,
} from './provider';
import { decodeAndValidateIdToken } from './id-token';

const APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_ISSUER = 'https://appleid.apple.com';

export interface AppleProviderConfig {
  client_id: string;
  /**
   * Apple's "client secret" is a JWT signed with your Apple-issued private key.
   * The caller is responsible for minting / refreshing it (it expires every 6
   * months). For test parity we accept the prebuilt string here — production
   * code will derive it from the secrets manager.
   */
  client_secret: string;
  fetchImpl?: typeof fetch;
}

/**
 * Apple Sign In (OIDC) differs from Google in two important ways:
 *
 *   1. CALLBACK IS POST: When `response_mode=form_post` is requested (which we
 *      do because Apple recommends it for `name` scope), Apple POSTs the
 *      callback rather than GETs it. The router handles both — this provider
 *      just returns the URL.
 *
 *   2. NAME IS SENT ONCE: On the user's FIRST sign-in only, Apple delivers
 *      the user's name in a separate `user` form field (NOT in the ID token).
 *      On subsequent sign-ins, the name is omitted. The router captures it
 *      and passes it through to the OAuthService; if absent here, we fall
 *      back to the email local-part.
 */
export class AppleProviderClient implements OAuthProviderClient {
  readonly name = 'apple' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AppleProviderConfig) {
    if (!config.client_id || !config.client_secret) {
      throw new OAuthConfigError('AppleProvider requires client_id and client_secret');
    }
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  authorizationUrl(state: string, redirect_uri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.client_id,
      redirect_uri,
      response_type: 'code',
      // Apple recommends form_post when name/email scopes are requested.
      response_mode: 'form_post',
      scope: 'name email',
      state,
    });
    return `${APPLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirect_uri: string): Promise<OAuthProfile> {
    const body = new URLSearchParams({
      code,
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
      redirect_uri,
      grant_type: 'authorization_code',
    });

    const response = await this.fetchImpl(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new OAuthExchangeError(
        `Apple token exchange failed (${response.status}): ${text.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as { id_token?: string };
    if (!payload.id_token) {
      throw new OAuthExchangeError('Apple token response missing id_token');
    }

    const claims = decodeAndValidateIdToken(payload.id_token, {
      expected_iss: APPLE_ISSUER,
      expected_aud: this.config.client_id,
    });

    return {
      provider: 'apple',
      oauth_id: claims.sub,
      email: claims.email!,
      // Apple never puts `name` in the ID token; the router will inject it
      // from the `user` form field on first sign-in if present, otherwise
      // we fall back here to the email local-part.
      display_name: claims.email!.split('@')[0],
    };
  }
}
