import { Request, Response, Router } from 'express';
import { ZodError } from 'zod';
import { AuthService, EmailAlreadyExistsError, InvalidCredentialsError, InvalidRefreshTokenError } from './auth-service';
import { JwtService } from './jwt-service';
import { registerSchema, loginSchema } from './validators';
import {
  RateLimiterStore,
  createRateLimitMiddleware,
} from './rate-limiter';

export const REFRESH_COOKIE_NAME = 'thoughtflow_refresh';

export interface AuthRouterOptions {
  authService: AuthService;
  jwtService: JwtService;
  rateLimiterStore: RateLimiterStore;
  /**
   * Whether to mark the refresh cookie Secure. Default true.
   * Test/dev (http://localhost) must override to false so the cookie
   * actually round-trips.
   */
  secureCookies?: boolean;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const { authService, jwtService, rateLimiterStore } = options;
  const secure = options.secureCookies ?? true;

  const loginLimiter = createRateLimitMiddleware({
    store: rateLimiterStore,
    scope: 'login',
    max: 5,
    window_ms: 60_000,
  });

  const registerLimiter = createRateLimitMiddleware({
    store: rateLimiterStore,
    scope: 'register',
    // WO-010 AC #7 unifies unauthenticated auth-endpoint rate at 5/min per IP.
    // Previously this was 3/min (more conservative for the account-creation
    // side effect); aligned to 5 to match the documented spec.
    max: 5,
    window_ms: 60_000,
  });

  const setRefreshCookie = (res: Response, token: string, expires_at: number): void => {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/auth',
      expires: new Date(expires_at * 1000),
    });
  };

  const clearRefreshCookie = (res: Response): void => {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/auth',
    });
  };

  router.post('/api/auth/register', registerLimiter, async (req: Request, res: Response) => {
    let input;
    try {
      input = registerSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({ error: 'validation_failed', details: err.issues });
        return;
      }
      throw err;
    }

    try {
      const result = await authService.register(input);
      setRefreshCookie(res, result.refresh_token, result.refresh_expires_at);
      res.status(201).json(result.response);
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        res.status(409).json({ error: 'email_already_exists' });
        return;
      }
      throw err;
    }
  });

  router.post('/api/auth/login', loginLimiter, async (req: Request, res: Response) => {
    let input;
    try {
      input = loginSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }
      throw err;
    }

    try {
      const result = await authService.login(input);
      setRefreshCookie(res, result.refresh_token, result.refresh_expires_at);
      res.status(200).json(result.response);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }
      throw err;
    }
  });

  router.post('/api/auth/refresh', async (req: Request, res: Response) => {
    const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE_NAME];
    if (!cookie) {
      res.status(401).json({ error: 'invalid_refresh_token' });
      return;
    }
    try {
      const result = await authService.refresh(cookie);
      setRefreshCookie(res, result.refresh_token, result.refresh_expires_at);
      res.status(200).json(result.response);
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        clearRefreshCookie(res);
        res.status(401).json({ error: 'invalid_refresh_token' });
        return;
      }
      throw err;
    }
  });

  router.post('/api/auth/logout', async (req: Request, res: Response) => {
    const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE_NAME];
    await authService.logout(cookie);
    clearRefreshCookie(res);
    res.status(204).end();
  });

  // Re-export jwtService for symmetry; some callers want it from the same module.
  void jwtService;

  return router;
}
