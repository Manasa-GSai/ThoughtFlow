export {
  OAuthService,
  OAuthAccountConflictError,
} from './oauth-service';
export type { OAuthServiceDeps, OAuthSignInResult } from './oauth-service';

export {
  OAuthConfigError,
  OAuthExchangeError,
} from './provider';
export type { OAuthProviderClient, OAuthProfile } from './provider';

export { GoogleProviderClient } from './google-provider';
export type { GoogleProviderConfig } from './google-provider';

export { AppleProviderClient } from './apple-provider';
export type { AppleProviderConfig } from './apple-provider';

export {
  decodeAndValidateIdToken,
  InvalidIdTokenError,
} from './id-token';
export type { IdTokenClaims, IdTokenValidationOptions } from './id-token';

export {
  createOAuthRouter,
  OAUTH_STATE_COOKIE,
} from './route';
export type { OAuthRouterOptions } from './route';
