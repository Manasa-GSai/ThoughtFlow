import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../../app';
import { createMetrics } from '../../metrics';
import { Logger } from '../../logger';
import { JwtService } from '../jwt-service';
import { BcryptPasswordHasher } from '../password-hasher';
import { GoogleProviderClient } from './google-provider';
import { AppleProviderClient } from './apple-provider';
import { OAUTH_STATE_COOKIE } from './route';
import { REFRESH_COOKIE_NAME } from '../route';

const silentLogger: Logger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};

const GOOGLE_CLIENT_ID = 'test-google-client';
const APPLE_CLIENT_ID = 'test-apple-client';

function makeIdToken(iss: string, aud: string, claims: Record<string, unknown>): string {
  return jwt.sign(
    {
      iss,
      aud,
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    'unused',
  );
}

function mockFetchReturning(id_token: string): typeof fetch {
  return ((_url: string, _init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id_token }),
      text: () => Promise.resolve(''),
    } as unknown as Response)) as typeof fetch;
}

function buildAppWithProviders(idTokens: { google?: string; apple?: string } = {}) {
  return createApp({
    logger: silentLogger,
    metrics: createMetrics({ collectDefaults: false }),
    passwordHasher: new BcryptPasswordHasher(4),
    jwtService: new JwtService({
      access_token_secret: 'a',
      refresh_token_secret: 'r',
    }),
    secureCookies: false,
    redis: null,
    googleOAuth: new GoogleProviderClient({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: 's',
      fetchImpl: mockFetchReturning(idTokens.google ?? ''),
    }),
    appleOAuth: new AppleProviderClient({
      client_id: APPLE_CLIENT_ID,
      client_secret: 's',
      fetchImpl: mockFetchReturning(idTokens.apple ?? ''),
    }),
  });
}

function extractCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];
  return cookies.find((c) => c.startsWith(`${name}=`));
}

describe('GET /api/auth/google — initiate (AC #1)', () => {
  it('redirects to Google consent screen and sets state cookie', async () => {
    const { app } = buildAppWithProviders();
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    expect(extractCookie(res, OAUTH_STATE_COOKIE)).toBeDefined();
  });
});

describe('GET /api/auth/google/callback — sign in (AC #2)', () => {
  it('exchanges code, creates user, sets refresh cookie, and redirects', async () => {
    const id_token = makeIdToken('https://accounts.google.com', GOOGLE_CLIENT_ID, {
      sub: 'google-sub-1',
      email: 'newuser@example.com',
      name: 'New User',
    });
    const ctx = buildAppWithProviders({ google: id_token });
    const agent = request.agent(ctx.app);

    // First hit /api/auth/google to set the state cookie
    const initiate = await agent.get('/api/auth/google');
    const stateCookie = extractCookie(initiate, OAUTH_STATE_COOKIE);
    expect(stateCookie).toBeDefined();
    const stateValue = stateCookie!.split('=')[1].split(';')[0];

    // Then hit callback with matching state
    const cb = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: stateValue });

    expect(cb.status).toBe(302);
    expect(extractCookie(cb, REFRESH_COOKIE_NAME)).toBeDefined();

    // Verify the user was actually persisted
    const created = await ctx.userStore.findByOAuth('google', 'google-sub-1');
    expect(created).not.toBeNull();
    expect(created!.email).toBe('newuser@example.com');
  });

  it('JSON return mode delivers tokens in body instead of redirect', async () => {
    const id_token = makeIdToken('https://accounts.google.com', GOOGLE_CLIENT_ID, {
      sub: 'g-json',
      email: 'json@example.com',
      name: 'JSON User',
    });
    const ctx = buildAppWithProviders({ google: id_token });
    const agent = request.agent(ctx.app);

    const initiate = await agent.get('/api/auth/google');
    const stateValue = extractCookie(initiate, OAUTH_STATE_COOKIE)!.split('=')[1].split(';')[0];

    const cb = await agent
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: stateValue, return: 'json' });

    expect(cb.status).toBe(200);
    expect(cb.body.access_token).toBeTruthy();
    expect(cb.body.user.email).toBe('json@example.com');
  });

  it('rejects callback when state cookie does not match query (CSRF defense)', async () => {
    const { app } = buildAppWithProviders();
    const res = await request(app)
      .get('/api/auth/google/callback')
      .set('Cookie', `${OAUTH_STATE_COOKIE}=expected-state`)
      .query({ code: 'auth-code', state: 'wrong-state' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('state_mismatch');
  });

  it('rejects callback when code is missing', async () => {
    const { app } = buildAppWithProviders();
    const res = await request(app)
      .get('/api/auth/google/callback')
      .set('Cookie', `${OAUTH_STATE_COOKIE}=s1`)
      .query({ state: 's1' });
    expect(res.headers.location).toContain('missing_code');
  });

  it('redirects to failure URL when token exchange fails', async () => {
    const ctx = createApp({
      logger: silentLogger,
      metrics: createMetrics({ collectDefaults: false }),
      passwordHasher: new BcryptPasswordHasher(4),
      jwtService: new JwtService({ access_token_secret: 'a', refresh_token_secret: 'r' }),
      secureCookies: false,
      redis: null,
      googleOAuth: new GoogleProviderClient({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: 's',
        // fetchImpl that always fails
        fetchImpl: ((): Promise<Response> =>
          Promise.resolve({
            ok: false,
            status: 400,
            json: () => Promise.resolve({}),
            text: () => Promise.resolve('error'),
          } as unknown as Response)) as typeof fetch,
      }),
      appleOAuth: null,
    });

    const res = await request(ctx.app)
      .get('/api/auth/google/callback')
      .set('Cookie', `${OAUTH_STATE_COOKIE}=s1`)
      .query({ code: 'bad', state: 's1' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('exchange_failed');
  });
});

describe('Apple OAuth (AC #3, #4)', () => {
  it('GET /api/auth/apple redirects to Apple Sign In', async () => {
    const { app } = buildAppWithProviders();
    const res = await request(app).get('/api/auth/apple');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('appleid.apple.com');
  });

  it('POST /api/auth/apple/callback processes POST-formatted callback', async () => {
    const id_token = makeIdToken('https://appleid.apple.com', APPLE_CLIENT_ID, {
      sub: 'apple-sub-1',
      email: 'apple-user@privaterelay.appleid.com',
    });
    const ctx = buildAppWithProviders({ apple: id_token });
    const agent = request.agent(ctx.app);

    const initiate = await agent.get('/api/auth/apple');
    const stateValue = extractCookie(initiate, OAUTH_STATE_COOKIE)!.split('=')[1].split(';')[0];

    const cb = await agent
      .post('/api/auth/apple/callback')
      .type('form')
      .send({ code: 'auth-code', state: stateValue });

    expect(cb.status).toBe(302);
    expect(extractCookie(cb, REFRESH_COOKIE_NAME)).toBeDefined();

    const created = await ctx.userStore.findByOAuth('apple', 'apple-sub-1');
    expect(created).not.toBeNull();
  });
});

describe('Account linking (AC #5)', () => {
  it('OAuth sign-in links to an existing password account when email matches', async () => {
    const id_token = makeIdToken('https://accounts.google.com', GOOGLE_CLIENT_ID, {
      sub: 'g-link-1',
      email: 'existing@test.com',
      name: 'Existing',
    });
    const ctx = buildAppWithProviders({ google: id_token });

    // Seed an existing password account
    await ctx.authService.register({
      email: 'existing@test.com',
      password: 'Password1A',
      displayName: 'Existing',
    });

    // OAuth sign-in via callback
    const agent = request.agent(ctx.app);
    const initiate = await agent.get('/api/auth/google');
    const stateValue = extractCookie(initiate, OAUTH_STATE_COOKIE)!.split('=')[1].split(';')[0];
    await agent
      .get('/api/auth/google/callback')
      .query({ code: 'c', state: stateValue, return: 'json' });

    // Both identities map to the SAME user
    const linked = await ctx.userStore.findByEmail('existing@test.com');
    expect(linked?.oauth_provider).toBe('google');
    expect(linked?.oauth_id).toBe('g-link-1');
    expect(linked?.password_hash).not.toBeNull(); // password preserved
  });
});

describe('Unconfigured providers (env not set)', () => {
  it('does not mount Google routes when google provider is null', async () => {
    const ctx = createApp({
      logger: silentLogger,
      metrics: createMetrics({ collectDefaults: false }),
      passwordHasher: new BcryptPasswordHasher(4),
      jwtService: new JwtService({ access_token_secret: 'a', refresh_token_secret: 'r' }),
      secureCookies: false,
      redis: null,
      googleOAuth: null,
      appleOAuth: null,
    });
    const res = await request(ctx.app).get('/api/auth/google');
    expect(res.status).toBe(404);
  });
});
