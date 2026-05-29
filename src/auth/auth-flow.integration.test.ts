import request, { Response } from 'supertest';
import { createApp, AppContext } from '../app';
import { Logger } from '../logger';
import { createMetrics } from '../metrics';
import { BcryptPasswordHasher } from './password-hasher';
import { JwtService } from './jwt-service';
import { createTestUser } from './test-fixtures';
import { REFRESH_COOKIE_NAME } from './route';

const silentLogger: Logger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};

function buildApp(): AppContext {
  return createApp({
    logger: silentLogger,
    metrics: createMetrics({ collectDefaults: false }),
    passwordHasher: new BcryptPasswordHasher(4), // fast hashing in tests
    jwtService: new JwtService({
      access_token_secret: 'test-access',
      refresh_token_secret: 'test-refresh',
      access_token_ttl_seconds: 60,
      refresh_token_ttl_seconds: 600,
    }),
    secureCookies: false, // supertest hits http://
  });
}

function extractRefreshCookie(res: Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown;
  const setCookie: string[] | undefined = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : undefined;
  return setCookie?.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

describe('Auth integration — full register → login → authed → refresh → logout flow', () => {
  it('completes the canonical happy path', async () => {
    const ctx = buildApp();
    const { app } = ctx;
    const reqHelper = request.agent(app); // supertest agent preserves cookies

    // 1. Register
    const reg = await reqHelper
      .post('/api/auth/register')
      .send({ email: 'flow@test.com', password: 'Password1A', displayName: 'Flow' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe('flow@test.com');
    expect(reg.body.access_token).toBeTruthy();
    expect(extractRefreshCookie(reg)).toBeDefined();

    // 2. Login
    const login = await reqHelper
      .post('/api/auth/login')
      .send({ email: 'flow@test.com', password: 'Password1A' });
    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeTruthy();

    // 3. Use access token against a protected route (we exercise requireAuth
    //    via an ad-hoc handler since no domain routes exist yet — proves the
    //    middleware works end-to-end).
    app.get('/test/protected', ctx.requireAuth, (req, res) => {
      res.json({ user: req.user });
    });

    const accessToken = login.body.access_token;
    const protectedRes = await request(app)
      .get('/test/protected')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body.user.email).toBe('flow@test.com');

    // 4. Without auth, the same route is rejected
    const unauthd = await request(app).get('/test/protected');
    expect(unauthd.status).toBe(401);

    // 5. Refresh — agent carries the cookie automatically
    const refreshCookieBefore = extractRefreshCookie(login);
    const refresh = await reqHelper.post('/api/auth/refresh');
    expect(refresh.status).toBe(200);
    expect(refresh.body.access_token).toBeTruthy();
    // The refresh COOKIE must change (rotation contract). Access-token strings
    // can be byte-identical if signed in the same second, so we assert on the
    // rotation that actually matters for security.
    const refreshCookieAfter = extractRefreshCookie(refresh);
    expect(refreshCookieAfter).toBeDefined();
    expect(refreshCookieAfter).not.toBe(refreshCookieBefore);

    // 6. Logout
    const logout = await reqHelper.post('/api/auth/logout');
    expect(logout.status).toBe(204);

    // 7. Subsequent refresh attempts fail (token was rotated AND then revoked)
    const refreshAfterLogout = await reqHelper.post('/api/auth/refresh');
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('register returns 409 on duplicate email', async () => {
    const { app } = buildApp();
    const valid = { email: 'dup@test.com', password: 'Password1A', displayName: 'D' };

    await request(app).post('/api/auth/register').send(valid).expect(201);
    const res = await request(app).post('/api/auth/register').send(valid);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_already_exists');
  });

  it('register returns 400 for password-rule violations', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.com', password: 'short1A', displayName: 'D' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('login returns 401 with generic error for wrong password', async () => {
    const { app } = buildApp();
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.com', password: 'Password1A', displayName: 'A' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'WrongPass1A' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('login returns same 401 + same body for unknown email (no enumeration)', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@here.com', password: 'Password1A' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  it('refresh cookie is httpOnly + SameSite=Strict + path=/api/auth', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'cookie@test.com', password: 'Password1A', displayName: 'C' });

    const cookie = extractRefreshCookie(res)!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('refresh without cookie returns 401', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('login rate limit blocks the 6th attempt within a minute', async () => {
    const { app } = buildApp();
    const ip = '9.9.9.9';
    const body = { email: 'rate@test.com', password: 'NotARealPassword1A' };

    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send(body);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('register rate limit blocks the 4th attempt within a minute', async () => {
    const { app } = buildApp();
    const ip = '8.8.8.8';

    let lastStatus = 0;
    for (let i = 0; i < 4; i += 1) {
      const res = await request(app)
        .post('/api/auth/register')
        .set('X-Forwarded-For', ip)
        .send({
          email: `reg${i}@test.com`,
          password: 'Password1A',
          displayName: 'R',
        });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('createTestUser fixture (AC #11)', () => {
  it('returns an authenticated user with a usable Authorization header', async () => {
    const ctx = buildApp();
    const user = await createTestUser(ctx);
    expect(user.authorization_header).toMatch(/^Bearer /);

    ctx.app.get('/test/me', ctx.requireAuth, (req, res) => {
      res.json({ id: req.user!.id });
    });

    const res = await request(ctx.app)
      .get('/test/me')
      .set('Authorization', user.authorization_header);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.response.user.id);
  });

  it('accepts custom email/password/displayName overrides', async () => {
    const ctx = buildApp();
    const user = await createTestUser(ctx, {
      email: 'custom@test.com',
      password: 'CustomPass1A',
      displayName: 'Custom',
    });
    expect(user.response.user.email).toBe('custom@test.com');
  });
});
