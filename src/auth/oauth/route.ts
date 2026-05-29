import { randomBytes } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { OAuthService, OAuthAccountConflictError } from './oauth-service';
import { OAuthProviderClient } from './provider';
import { REFRESH_COOKIE_NAME } from '../route';

export const OAUTH_STATE_COOKIE = 'thoughtflow_oauth_state';

export interface OAuthRouterOptions {
  oauthService: OAuthService;
  google?: OAuthProviderClient;
  apple?: OAuthProviderClient;
  /**
   * Base URL the provider redirects back to. Defaults to building from
   * the incoming request — explicit override matters when the API is
   * behind a load balancer with a different external hostname.
   */
  redirectBase?: string;
  /** Where the browser lands after a successful sign-in. Defaults to '/'. */
  successRedirect?: string;
  /** Where the browser lands after a sign-in failure. Defaults to '/login?error=oauth'. */
  failureRedirect?: string;
  secureCookies?: boolean;
}

/**
 * CSRF protection: every authorizationUrl() call generates a random state
 * token that we store in a short-lived httpOnly cookie. On callback we
 * compare the cookie value to the `state` query param. Mismatch → reject.
 * The cookie lifetime mirrors the upstream OAuth provider's typical
 * authorization flow (10 minutes is enough for users to complete consent).
 */
const STATE_COOKIE_TTL_MS = 10 * 60 * 1000;

export function createOAuthRouter(options: OAuthRouterOptions): Router {
  const router = Router();
  const secure = options.secureCookies ?? true;
  const successRedirect = options.successRedirect ?? '/';
  const failureRedirect = options.failureRedirect ?? '/login?error=oauth';

  const setStateCookie = (res: Response, state: string): void => {
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure,
      sameSite: 'lax', // 'strict' breaks cross-site OAuth redirects
      path: '/api/auth',
      maxAge: STATE_COOKIE_TTL_MS,
    });
  };

  const clearStateCookie = (res: Response): void => {
    res.clearCookie(OAUTH_STATE_COOKIE, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/api/auth',
    });
  };

  const setRefreshCookie = (res: Response, token: string, expires_at: number): void => {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api/auth',
      expires: new Date(expires_at * 1000),
    });
  };

  const buildRedirectUri = (req: Request, provider: 'google' | 'apple'): string => {
    if (options.redirectBase) {
      return `${options.redirectBase.replace(/\/$/, '')}/api/auth/${provider}/callback`;
    }
    return `${req.protocol}://${req.get('host')}/api/auth/${provider}/callback`;
  };

  if (options.google) {
    mountProvider(router, options.google, options, {
      setStateCookie,
      clearStateCookie,
      setRefreshCookie,
      buildRedirectUri: (req) => buildRedirectUri(req, 'google'),
      method: 'GET',
      successRedirect,
      failureRedirect,
    });
  }
  if (options.apple) {
    mountProvider(router, options.apple, options, {
      setStateCookie,
      clearStateCookie,
      setRefreshCookie,
      buildRedirectUri: (req) => buildRedirectUri(req, 'apple'),
      method: 'POST', // Apple POSTs the callback when response_mode=form_post
      successRedirect,
      failureRedirect,
    });
  }

  return router;
}

interface MountHooks {
  setStateCookie: (res: Response, state: string) => void;
  clearStateCookie: (res: Response) => void;
  setRefreshCookie: (res: Response, token: string, expires_at: number) => void;
  buildRedirectUri: (req: Request) => string;
  method: 'GET' | 'POST';
  successRedirect: string;
  failureRedirect: string;
}

function mountProvider(
  router: Router,
  client: OAuthProviderClient,
  options: OAuthRouterOptions,
  hooks: MountHooks,
): void {
  const initiatePath = `/api/auth/${client.name}`;
  const callbackPath = `/api/auth/${client.name}/callback`;

  // 1. Initiate — generate state, set cookie, redirect to provider
  router.get(initiatePath, (req: Request, res: Response) => {
    const state = randomBytes(24).toString('base64url');
    hooks.setStateCookie(res, state);
    const url = client.authorizationUrl(state, hooks.buildRedirectUri(req));
    res.redirect(url);
  });

  // 2. Callback — verify state, exchange code, sign in user
  const callbackHandler = async (req: Request, res: Response): Promise<void> => {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const state_cookie = cookies[OAUTH_STATE_COOKIE];

    const incoming_state = (req.query.state as string) || (req.body?.state as string);
    const code = (req.query.code as string) || (req.body?.code as string);

    hooks.clearStateCookie(res);

    if (!state_cookie || !incoming_state || state_cookie !== incoming_state) {
      res.redirect(`${hooks.failureRedirect}&reason=state_mismatch`);
      return;
    }
    if (!code) {
      res.redirect(`${hooks.failureRedirect}&reason=missing_code`);
      return;
    }

    try {
      const profile = await client.exchangeCode(code, hooks.buildRedirectUri(req));
      const result = await options.oauthService.signIn(profile);
      hooks.setRefreshCookie(res, result.refresh_token, result.refresh_expires_at);

      // Most flows want a redirect back to the SPA, but JSON consumers (CLI,
      // mobile) can opt in with `?return=json` so they get the access token
      // in the body rather than locked inside a cookie.
      const want_json =
        (req.query.return as string) === 'json' || (req.body?.return as string) === 'json';
      if (want_json) {
        res.status(200).json(result.response);
        return;
      }
      res.redirect(hooks.successRedirect);
    } catch (err) {
      if (err instanceof OAuthAccountConflictError) {
        res.redirect(`${hooks.failureRedirect}&reason=account_conflict`);
        return;
      }
      res.redirect(`${hooks.failureRedirect}&reason=exchange_failed`);
    }
  };

  if (hooks.method === 'GET') {
    router.get(callbackPath, callbackHandler);
  } else {
    router.post(callbackPath, callbackHandler);
  }
}
