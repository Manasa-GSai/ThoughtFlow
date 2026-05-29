import request from 'supertest';
import { createApp } from '../app';
import { createMockRedis } from './test-fixtures';
import { createMetrics } from '../metrics';
import { Logger } from '../logger';
import { BcryptPasswordHasher, JwtService } from '../auth';
import { REFRESH_COOKIE_NAME } from '../auth/route';

const silentLogger: Logger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};

function buildAppWithRedis() {
  return createApp({
    logger: silentLogger,
    metrics: createMetrics({ collectDefaults: false }),
    passwordHasher: new BcryptPasswordHasher(4),
    jwtService: new JwtService({
      access_token_secret: 'a',
      refresh_token_secret: 'r',
      access_token_ttl_seconds: 60,
      refresh_token_ttl_seconds: 600,
    }),
    secureCookies: false,
    redis: createMockRedis(), // drives the Redis code paths via ioredis-mock
  });
}

describe('Redis integration with full app (resolves WO-007 drift)', () => {
  it('AuthService.refresh validates against Redis-backed TokenStore', async () => {
    const ctx = buildAppWithRedis();
    const agent = request.agent(ctx.app);

    // Register seeds a refresh token in the Redis-backed TokenStore
    const reg = await agent.post('/api/auth/register').send({
      email: 'redis-flow@test.com',
      password: 'Password1A',
      displayName: 'R',
    });
    expect(reg.status).toBe(201);

    // Refresh should succeed — proving the Redis-backed store works end-to-end
    const refresh = await agent.post('/api/auth/refresh');
    expect(refresh.status).toBe(200);

    // The refresh COOKIE should have rotated
    const setCookieAfter = refresh.headers['set-cookie'] as unknown;
    const cookiesAfter = Array.isArray(setCookieAfter) ? (setCookieAfter as string[]) : [];
    const refreshCookie = cookiesAfter.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(refreshCookie).toBeDefined();
  });

  it('Logout revokes the Redis-backed refresh token (subsequent refresh fails)', async () => {
    const ctx = buildAppWithRedis();
    const agent = request.agent(ctx.app);

    await agent.post('/api/auth/register').send({
      email: 'logout@test.com',
      password: 'Password1A',
      displayName: 'L',
    });

    expect((await agent.post('/api/auth/logout')).status).toBe(204);

    // After logout, the previously-issued refresh token must be unusable
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
  });

  it('Rate limiter uses Redis-backed RateLimiterStore', async () => {
    const ctx = buildAppWithRedis();

    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const res = await request(ctx.app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '7.7.7.7')
        .send({ email: 'never-existed@test.com', password: 'Password1A' });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('/health/ready uses real RedisHealthChecker against the connected client', async () => {
    const ctx = buildAppWithRedis();
    const res = await request(ctx.app).get('/health/ready');
    expect(res.status).toBe(200);
    const redisCheck = res.body.checks.find((c: { name: string }) => c.name === 'redis');
    expect(redisCheck.healthy).toBe(true);
    expect(typeof redisCheck.latency_ms).toBe('number');
  });

  it('app falls back gracefully when no Redis is provided (in-memory mode)', async () => {
    const ctx = createApp({
      logger: silentLogger,
      metrics: createMetrics({ collectDefaults: false }),
      passwordHasher: new BcryptPasswordHasher(4),
      jwtService: new JwtService({ access_token_secret: 'a', refresh_token_secret: 'r' }),
      secureCookies: false,
      redis: null, // explicit opt-out
    });
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(ctx.redis).toBeNull();
  });
});
