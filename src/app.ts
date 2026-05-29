import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
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

export interface AppOptions {
  /** Service name attached to every log entry */
  service?: string;
  /** Build version / git SHA reported by GET /health */
  version?: string;
  /** Dependency checkers consulted by GET /health/ready */
  checkers?: HealthChecker[];
  /** Pre-built logger (lets tests capture output) */
  logger?: Logger;
  /** Pre-built metrics registry (lets tests use isolated registries) */
  metrics?: Metrics;
  /** Pre-built user store — WO-003 will swap in a Postgres impl */
  userStore?: UserStore;
  /** Pre-built token store — WO-004 will swap in a Redis impl */
  tokenStore?: TokenStore;
  /** Pre-built password hasher (tests can inject a fast/no-op variant) */
  passwordHasher?: PasswordHasher;
  /** Pre-built JWT service (or supply secrets to construct one) */
  jwtService?: JwtService;
  /** Pre-built rate limiter store — WO-010 will swap in a Redis impl */
  rateLimiterStore?: RateLimiterStore;
  /**
   * Whether to mark refresh cookies Secure. Default true (production).
   * Override to false for HTTP integration tests against supertest.
   */
  secureCookies?: boolean;
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
  requireAuth: ReturnType<typeof createRequireAuthMiddleware>;
}

/**
 * App factory mounting WO-005 middlewares (correlation + request logger),
 * WO-006 observability routes (/health, /health/ready, /metrics), and
 * WO-007 auth routes (/api/auth/*) + requireAuth middleware export.
 *
 * Auth dependencies follow the strategy pattern: callers can inject
 * production stores (Postgres/Redis when WO-003/WO-004 land) or use the
 * defaults (in-memory for dev/tests). JWT secrets default to test-only
 * values when NODE_ENV !== 'production'; production deployments MUST
 * supply real secrets via JWT_ACCESS_SECRET / JWT_REFRESH_SECRET env vars.
 */
export function createApp(options: AppOptions = {}): AppContext {
  const service = options.service ?? 'thoughtflow-api';
  const version = options.version ?? process.env.APP_VERSION ?? 'dev';
  const checkers = options.checkers ?? [okChecker('postgres'), okChecker('redis')];

  const logger = options.logger ?? createLogger({ service });
  const metrics = options.metrics ?? createMetrics();
  const userStore = options.userStore ?? new InMemoryUserStore();
  const tokenStore = options.tokenStore ?? new InMemoryTokenStore();
  const passwordHasher = options.passwordHasher ?? new BcryptPasswordHasher();
  const jwtService = options.jwtService ?? buildJwtServiceFromEnv();
  const rateLimiterStore = options.rateLimiterStore ?? new InMemoryRateLimiterStore();
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';

  const authService = new AuthService({
    userStore,
    tokenStore,
    passwordHasher,
    jwtService,
  });
  const requireAuth = createRequireAuthMiddleware(jwtService);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // honor X-Forwarded-For for req.ip (rate limiter)
  app.use(express.json());
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
