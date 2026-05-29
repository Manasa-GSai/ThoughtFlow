import { OAuthProvider as OAuthProviderName } from '../types';

/**
 * Profile returned by an OAuth provider after a successful authorization
 * code exchange. ID tokens from Google and Apple both contain these claims;
 * the provider implementations decode their JWT ID tokens and normalize the
 * shape so the OAuthService is provider-agnostic downstream.
 */
export interface OAuthProfile {
  provider: OAuthProviderName;
  /** Provider's stable unique identifier for the user (sub claim). */
  oauth_id: string;
  /** Email address — both Google and Apple include this when scope=email is granted. */
  email: string;
  /**
   * Display name. Google provides via the ID token `name` claim; Apple ONLY
   * sends a user's name on the FIRST sign-in, via a separate `user` form
   * field — we fall back to the email local-part when name is unavailable.
   */
  display_name: string;
}

/**
 * Contract every OAuth provider implements. Implementations are stateless;
 * state for the CSRF nonce is held in a short-lived cookie by the router
 * layer rather than in the provider.
 */
export interface OAuthProviderClient {
  readonly name: OAuthProviderName;
  /**
   * Build the URL the browser is redirected to. `state` is a random token
   * the router will round-trip via cookie to defend against CSRF.
   */
  authorizationUrl(state: string, redirect_uri: string): string;
  /**
   * Exchange the authorization code for an ID token and return the
   * normalized profile.
   */
  exchangeCode(code: string, redirect_uri: string): Promise<OAuthProfile>;
}

export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthConfigError';
  }
}

export class OAuthExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthExchangeError';
  }
}
