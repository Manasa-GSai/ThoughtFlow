import request from 'supertest';
import { createApp } from './app';
import { createMetrics } from './metrics';
import { HealthChecker, okChecker } from './health';
import { Logger } from './logger';

// Silent logger keeps integration test output noise-free.
const silentLogger: Logger = {
  fatal: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};

describe('createApp — integration', () => {
  it('GET /health returns 200 with status, version, and uptime', async () => {
    const { app } = createApp({
      version: 'abc1234',
      metrics: createMetrics({ collectDefaults: false }),
      logger: silentLogger,
    });
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('abc1234');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('GET /health/ready returns 200 when all checkers pass', async () => {
    const { app } = createApp({
      checkers: [okChecker('postgres'), okChecker('redis')],
      metrics: createMetrics({ collectDefaults: false }),
      logger: silentLogger,
    });
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.checks.map((c: { name: string }) => c.name).sort()).toEqual([
      'postgres',
      'redis',
    ]);
  });

  it('GET /health/ready returns 503 with details when a dependency is unhealthy', async () => {
    const failingRedis: HealthChecker = {
      name: 'redis',
      check: async () => ({ healthy: false, message: 'ECONNREFUSED' }),
    };
    const { app } = createApp({
      checkers: [okChecker('postgres'), failingRedis],
      metrics: createMetrics({ collectDefaults: false }),
      logger: silentLogger,
    });

    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
    const redis = res.body.checks.find((c: { name: string }) => c.name === 'redis');
    expect(redis.healthy).toBe(false);
    expect(redis.message).toBe('ECONNREFUSED');
  });

  it('GET /metrics returns Prometheus text format', async () => {
    const { app } = createApp({
      metrics: createMetrics({ collectDefaults: false }),
      logger: silentLogger,
    });
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain.*version=/);
    expect(res.text).toContain('# HELP http_request_duration_seconds');
    expect(res.text).toContain('# TYPE http_requests_total counter');
  });

  it('/metrics output reflects requests made to other endpoints', async () => {
    const { app } = createApp({
      metrics: createMetrics({ collectDefaults: false }),
      logger: silentLogger,
    });

    // Hit a few endpoints to generate metrics
    await request(app).get('/health');
    await request(app).get('/health');
    await request(app).get('/health/ready');
    await request(app).get('/does-not-exist');

    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="\/health",status_code="200"\}\s+2/,
    );
    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="\/health\/ready",status_code="200"\}\s+1/,
    );
    expect(res.text).toMatch(
      /http_requests_total\{[^}]*status_code="404"[^}]*\}\s+1/,
    );
  });

  it('echoes a generated X-Correlation-ID response header on every request', async () => {
    const { app } = createApp({
      metrics: createMetrics({ collectDefaults: false }),
      logger: silentLogger,
    });
    const res = await request(app).get('/health');

    expect(res.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('reuses the incoming X-Correlation-ID header', async () => {
    const { app } = createApp({
      metrics: createMetrics({ collectDefaults: false }),
      logger: silentLogger,
    });
    const res = await request(app)
      .get('/health')
      .set('X-Correlation-ID', 'integration-test-trace-1');

    expect(res.headers['x-correlation-id']).toBe('integration-test-trace-1');
  });

  it('disables the x-powered-by header for security', async () => {
    const { app } = createApp({
      metrics: createMetrics({ collectDefaults: false }),
      logger: silentLogger,
    });
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
