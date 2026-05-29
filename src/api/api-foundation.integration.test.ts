import request from 'supertest';
import { createApp } from '../app';
import { createMetrics } from '../metrics';
import { Logger } from '../logger';
import { BcryptPasswordHasher, JwtService } from '../auth';

const silentLogger: Logger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};

function buildApp(overrides: Parameters<typeof createApp>[0] = {}) {
  return createApp({
    logger: silentLogger,
    metrics: createMetrics({ collectDefaults: false }),
    passwordHasher: new BcryptPasswordHasher(4),
    jwtService: new JwtService({
      access_token_secret: 'a',
      refresh_token_secret: 'r',
    }),
    secureCookies: false,
    redis: null, // exercise the in-memory fallback path
    ...overrides,
  });
}

describe('Express API Foundation — security headers (AC #8)', () => {
  it('sets helmet defaults (X-Content-Type-Options, X-Frame-Options, etc.)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('does not expose x-powered-by header', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('Express API Foundation — CORS (AC #2)', () => {
  it('echoes the configured CORS origin and credentials=true', async () => {
    const { app } = buildApp({ corsOrigin: 'https://app.thoughtflow.io' });
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://app.thoughtflow.io');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.thoughtflow.io');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('disallows cross-origin by default when CORS_ORIGIN is unset', async () => {
    const original = process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGIN;
    try {
      const { app } = buildApp({ corsOrigin: undefined });
      const res = await request(app)
        .get('/health')
        .set('Origin', 'https://evil.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      if (original !== undefined) process.env.CORS_ORIGIN = original;
    }
  });

  it('responds to OPTIONS preflight', async () => {
    const { app } = buildApp({ corsOrigin: 'https://app.thoughtflow.io' });
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://app.thoughtflow.io')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.thoughtflow.io');
  });
});

describe('Express API Foundation — body parsing (AC #3)', () => {
  it('JSON body parser rejects payloads larger than the configured limit', async () => {
    const { app } = buildApp({ jsonBodyLimit: '1kb' });
    const oversized = { blob: 'x'.repeat(2000) };
    const res = await request(app)
      .post('/api/auth/login')
      .send(oversized);
    expect(res.status).toBe(413);
  });

  it('JSON body parser accepts payloads at the default limit', async () => {
    const { app } = buildApp(); // default 1mb
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'wrong' });
    // login routes still return 401 for unknown creds; what we care about is
    // that the JSON body was parsed and routed (NOT a 413/400 from the parser)
    expect([200, 401]).toContain(res.status);
  });
});

describe('Express API Foundation — placeholder route trees (AC #7)', () => {
  it.each([
    ['/api/thoughts', 'GET'],
    ['/api/thoughts/123', 'GET'],
    ['/api/sync/push', 'POST'],
    ['/api/user/profile', 'GET'],
  ])('%s %s returns 404 not_implemented', async (path, method) => {
    const { app } = buildApp();
    const res =
      method === 'GET' ? await request(app).get(path) : await request(app).post(path);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
    expect(res.body.message).toContain('not yet implemented');
  });
});

describe('Express API Foundation — centralized error handler (AC #5)', () => {
  it('completely unknown routes return 404 with consistent shape', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/totally-unknown-path');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: 'not_found',
      correlation_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
  });

  it('validation failures on auth/register return 400 with field details', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad', password: '7', displayName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('error response always carries the correlation_id for support correlation', async () => {
    const { app } = buildApp();
    // Hit a placeholder route to ensure the response goes through the central
    // error handler (auth routes have their own per-error formatting and
    // bypass the central handler for now — feature WOs will migrate them).
    const res = await request(app)
      .get('/api/thoughts/123')
      .set('X-Correlation-ID', 'test-trace-99');
    expect(res.status).toBe(404);
    expect(res.body.correlation_id).toBe('test-trace-99');
  });
});

describe('Express API Foundation — server bootstrap (AC #1, #6)', () => {
  it('startServer listens on a free port and stops on demand', async () => {
    const { startServer } = await import('../server');
    const ctx = buildApp();
    const running = await startServer({
      port: 0, // 0 = OS-assigned free port
      install_signal_handlers: false,
      context: ctx,
    });
    const address = running.server.address();
    expect(address && typeof address === 'object').toBe(true);
    if (address && typeof address === 'object') {
      expect(address.port).toBeGreaterThan(0);
    }
    await running.stop();
    expect(running.server.listening).toBe(false);
  });

  it('stop() is idempotent', async () => {
    const { startServer } = await import('../server');
    const running = await startServer({
      port: 0,
      install_signal_handlers: false,
      context: buildApp(),
    });
    await running.stop();
    await expect(running.stop()).resolves.toBeUndefined();
  });
});
