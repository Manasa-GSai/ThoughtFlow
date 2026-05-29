export { AuthService, EmailAlreadyExistsError, InvalidCredentialsError, InvalidRefreshTokenError } from './auth-service';
export type { AuthServiceDeps } from './auth-service';
export { BcryptPasswordHasher } from './password-hasher';
export type { PasswordHasher } from './password-hasher';
export { JwtService, DEFAULT_ACCESS_TTL_SECONDS, DEFAULT_REFRESH_TTL_SECONDS } from './jwt-service';
export type { JwtConfig } from './jwt-service';
export { InMemoryUserStore } from './user-store';
export type { UserStore, CreateUserInput } from './user-store';
export { InMemoryTokenStore } from './token-store';
export type { TokenStore } from './token-store';
export { createRequireAuthMiddleware } from './middleware';
export {
  InMemoryRateLimiterStore,
  createRateLimitMiddleware,
} from './rate-limiter';
export type { RateLimiterStore, RateLimitOptions } from './rate-limiter';
export { createAuthRouter, REFRESH_COOKIE_NAME } from './route';
export type { AuthRouterOptions } from './route';
export { registerSchema, loginSchema } from './validators';
export type { RegisterInput, LoginInput } from './validators';
export type {
  User,
  UserTier,
  AuthenticatedUser,
  RefreshTokenRecord,
  AccessTokenClaims,
  RefreshTokenClaims,
  AuthSuccessResponse,
} from './types';
