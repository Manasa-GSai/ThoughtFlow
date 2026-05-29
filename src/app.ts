import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import type Redis from 'ioredis';
import { correlationIdMiddleware, createRequestLoggerMiddleware } from './middleware';
import { createLogger, Logger } from './logger';
import {
  createMetrics,
  createHttpMetricsMiddleware,
  createMetricsRouter,
  Metrics,
} from './metrics';
import { createHealthRouter, HealthChecker, okChecker } from './health';
import {
  AuthService,
  BcryptPasswordHasher,
  InMemoryRateLimiterStore,
  InMemoryTokenStore,
  InMemoryUserStore,
  JwtService,
  RateLimiterStore,
  TokenStore,
  UserStore,
  PasswordHasher,
  createAuthRouter,
  createRequireAuthMiddleware,
} from './auth';
import {
  RateLimitHelper,
  RedisHealthChecker,
  RedisRateLimitHelper,
  RedisRateLimiterStore,
  RedisSessionHelper,
  RedisTokenStore,
  SessionHelper,
  InMemoryRateLimitHelper,
  InMemorySessionHelper,
  createRedisClient,
} from './redis';
import {
  createErrorHandler,
  notFoundHandler,
  createThoughtsPlaceholderRouter,
  createSyncPlaceholderRouter,
  createUserPlaceholderRouter,
} from './api';

export interface AppOptions {
  service?: string;
  version?: string;
  /** Dependency checkers consulted by GET /health/ready */
  checkers?: HealthChecker[];
  logger?: Logger;
  metrics?: Metrics;
  /** Pre-built user store — WO-003 plug-in point for Postgres impl */
  userStore?: UserStore;
  /**
   * Pre-built token store. If unset, derived from `redis` when available, or
   * an in-memory fallback otherwise.
   */
  tokenStore?: TokenStore;
  passwordHasher?: PasswordHasher;
  jwtService?: JwtService;
  /**
   * Pre-built auth rate-limiter store (login/register IP throttling). If unset,
   * derived from `redis` when available, in-memory otherwise.
   */
  rateLimiterStore?: RateLimiterStore;
  /**
   * Pre-built Redis client. If unset and REDIS_URL is in env, one is created.
   * Pass an ioredis-mock instance from tests to exercise the Redis code paths
   * without a real server.
   */
  redis?: Redis | null;
  /**
   * Pre-built helpers (tier-aware session + rate limit). If unset, derived
   * from `redis` when available, in-memory otherwise.
   */
  sessionHelper?: SessionHelper;
  rateLimitHelper?: RateLimitHelper;
  /**
   * Whether to mark refresh cookies Secure. Default true in production.
   */
  secureCookies?: boolean;
  /**
   * CORS allow-list. Accepts a single origin, an array, or a function. When
   * unset, falls back to CORS_ORIGIN env var (comma-separated list) or
   * disallows cross-origin requests entirely.
   */
  corsOrigin?: CorsOptions['origin'];
  /** JSON body parser limit. Default '1mb' per AC #3. */
  jsonBodyLimit?: string;
}

export interface AppContext {
  app: Express;
  logger: Logger;
  metrics: Metrics;
  authService: AuthService;
  jwtService: JwtService;
  userStore: UserStore;
  tokenStore: TokenStore;
  passwordHasher: PasswordHasher;
  rateLimiterStore: RateLimiterStore;
  /** The active Redis client, or null when running with in-memory fallbacks. */
  redis: Redis | null;
  sessionHelper: SessionHelper;
  rateLimitHelper: RateLimitHelper;
  requireAuth: ReturnType<typeof createRequireAuthMiddleware>;
}

/**
 * App factory wiring all foundation WOs:
 *   - WO-005 (correlation + request logger middlewares)
 *   - WO-006 (/health, /health/ready, /metrics routes)
 *   - WO-007 (auth routes + requireAuth middleware)
 *   - WO-004 (Redis helpers for sessions + rate limiting, with in-memory fallback)
 *
 * Redis wiring policy (AC #7 graceful fallback):
 *   - If `options.redis` is supplied → use it.
 *   - Else if REDIS_URL is set in env → connect to it.
 *   - Else → log a warning and run all helpers against in-memory implementations.
 *
 * The in-memory path has degraded accuracy in multi-instance deployments;
 * the warning lets operators see the degradation in logs.
 */
export function createApp(options: AppOptions = {}): AppContext {
  const service = options.service ?? 'thoughtflow-api';
  const version = options.version ?? process.env.APP_VERSION ?? 'dev';
  const logger = options.logger ?? createLogger({ service });
  const metrics = options.metrics ?? createMetrics();

  // Resolve Redis first so dependent helpers can be derived from it.
  const redis =
    options.redis !== undefined
      ? options.redis
      : createRedisClient({
          url: process.env.REDIS_URL,
          password: process.env.REDIS_PASSWORD,
          onReconnect: (attempt, delayMs) => {
            logger.warn('redis_reconnect', { attempt, delay_ms: delayMs });
          },
          onError: (err) => {
            logger.error('redis_error', { error_message: err.message });
          },
        });

  if (!redis && !options.redis) {
    logger.warn('redis_unavailable_using_in_memory_fallback', {
      note: 'Sessions + rate limits run per-process — multi-instance deployments will have degraded accuracy. Set REDIS_URL to enable Redis.',
    });
  }

  // Sessions + tier-aware rate limit (BR-1, BR-9)
  const sessionHelper: SessionHelper =
    options.sessionHelper ?? (redis ? new RedisSessionHelper(redis) : new InMemorySessionHelper());
  const rateLimitHelper: RateLimitHelper =
    options.rateLimitHelper ?? (redis ? new RedisRateLimitHelper(redis) : new InMemoryRateLimitHelper());

  // Auth wiring — TokenStore + auth-endpoint rate limiter
  const userStore = options.userStore ?? new InMemoryUserStore();
  const tokenStore =
    options.tokenStore ?? (redis ? new RedisTokenStore(sessionHelper) : new InMemoryTokenStore());
  const passwordHasher = options.passwordHasher ?? new BcryptPasswordHasher();
  const jwtService = options.jwtService ?? buildJwtServiceFromEnv();
  const rateLimiterStore =
    options.rateLimiterStore ?? (redis ? new RedisRateLimiterStore(redis) : new InMemoryRateLimiterStore());
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';

  // Readiness checkers: real Redis check when we have a client, placeholder otherwise.
  const checkers = options.checkers ?? [
    okChecker('postgres'),
    redis ? new RedisHealthChecker(redis) : okChecker('redis'),
  ];

  const authService = new AuthService({ userStore, tokenStore, passwordHasher, jwtService });
  const requireAuth = createRequireAuthMiddleware(jwtService);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Security headers (AC #8) — defaults to sane HSTS/XCTO/XFO/etc.
  app.use(helmet());

  // CORS with credentials so the refresh cookie is sent on cross-origin requests.
  const corsOrigin = options.corsOrigin ?? resolveCorsOriginFromEnv();
  app.use(cors({ origin: corsOrigin, credentials: true }));

  // Body parsers — JSON 1MB default (AC #3). Multipart is mounted per-route
  // (audio upload route in WO-012) at the 25MB limit, NOT globally, so other
  // endpoints don't accept oversize uploads.
  app.use(express.json({ limit: options.jsonBodyLimit ?? '1mb' }));
  app.use(cookieParser());

  app.use(correlationIdMiddleware);
  app.use(createHttpMetricsMiddleware(metrics));
  app.use(createRequestLoggerMiddleware(logger));

  app.use(createHealthRouter({ version, checkers }));
  app.use(createMetricsRouter(metrics));
  app.use(
    createAuthRouter({
      authService,
      jwtService,
      rateLimiterStore,
      secureCookies,
    }),
  );

  // Placeholder route trees (AC #7) — return 404 with `not_implemented` hint
  // until each feature WO lands its real router.
  app.use('/api/thoughts', createThoughtsPlaceholderRouter());
  app.use('/api/sync', createSyncPlaceholderRouter());
  app.use('/api/user', createUserPlaceholderRouter());

  // Catch-all 404 + centralized error handler (AC #5). Must be mounted LAST.
  app.use(notFoundHandler());
  app.use(createErrorHandler(logger));

  return {
    app,
    logger,
    metrics,
    authService,
    jwtService,
    userStore,
    tokenStore,
    passwordHasher,
    rateLimiterStore,
    redis,
    sessionHelper,
    rateLimitHelper,
    requireAuth,
  };
}

function buildJwtServiceFromEnv(): JwtService {
  const access_token_secret = process.env.JWT_ACCESS_SECRET ?? defaultDevSecret('access');
  const refresh_token_secret = process.env.JWT_REFRESH_SECRET ?? defaultDevSecret('refresh');
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
      throw new Error(
        'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET environment variables are required in production',
      );
    }
  }
  return new JwtService({ access_token_secret, refresh_token_secret });
}

function defaultDevSecret(label: string): string {
  return `dev-only-${label}-secret-do-not-use-in-production`;
}

/**
 * Resolves CORS_ORIGIN from environment. Accepts comma-separated origins
 * (e.g., "https://app.thoughtflow.io,https://staging.thoughtflow.io") or a
 * single origin. When unset, returns `false` — disallows all cross-origin
 * requests, which is the secure default for a backend with no frontend
 * deployed yet.
 */
function resolveCorsOriginFromEnv(): CorsOptions['origin'] {
  const raw = process.env.CORS_ORIGIN;
  if (!raw) return false;
  const origins = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length === 1) return origins[0];
  return origins;
}
