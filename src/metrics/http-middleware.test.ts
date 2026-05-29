import { EventEmitter } from 'node:events';
import { Request, Response, NextFunction } from 'express';
import { createMetrics } from './registry';
import { createHttpMetricsMiddleware } from './http-middleware';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/x',
    url: '/x',
    baseUrl: '',
    ...overrides,
  } as Request;
}

function mockRes(statusCode = 200): Response & EventEmitter {
  const emitter = new EventEmitter() as EventEmitter & Partial<Response>;
  emitter.statusCode = statusCode;
  return emitter as Response & EventEmitter;
}

describe('createHttpMetricsMiddleware', () => {
  it('increments http_requests_total on response finish', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const mw = createHttpMetricsMiddleware(metrics);
    const req = mockReq({ method: 'POST', path: '/api/thoughts' });
    const res = mockRes(201);

    mw(req, res, jest.fn() as NextFunction);
    res.emit('finish');

    const out = await metrics.registry.metrics();
    expect(out).toMatch(
      /http_requests_total\{method="POST",route="\/api\/thoughts",status_code="201"\}\s+1/,
    );
  });

  it('observes http_request_duration_seconds on finish', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const mw = createHttpMetricsMiddleware(metrics);
    const req = mockReq();
    const res = mockRes(200);

    mw(req, res, jest.fn() as NextFunction);
    res.emit('finish');

    const out = await metrics.registry.metrics();
    expect(out).toContain('http_request_duration_seconds_count');
    expect(out).toMatch(/http_request_duration_seconds_count\{[^}]*\}\s+1/);
  });

  it('uses the matched route template when available', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const mw = createHttpMetricsMiddleware(metrics);
    const req = mockReq({
      method: 'GET',
      path: '/users/42',
      route: { path: '/users/:id' } as unknown as Request['route'],
      baseUrl: '',
    });
    const res = mockRes(200);

    mw(req, res, jest.fn() as NextFunction);
    res.emit('finish');

    const out = await metrics.registry.metrics();
    expect(out).toContain('route="/users/:id"');
    expect(out).not.toMatch(/route="\/users\/42"/);
  });

  it('prepends baseUrl to matched route', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const mw = createHttpMetricsMiddleware(metrics);
    const req = mockReq({
      method: 'GET',
      baseUrl: '/api',
      route: { path: '/users/:id' } as unknown as Request['route'],
    });
    const res = mockRes(200);

    mw(req, res, jest.fn() as NextFunction);
    res.emit('finish');

    const out = await metrics.registry.metrics();
    expect(out).toContain('route="/api/users/:id"');
  });

  it('increments active_connections during request and decrements on finish', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const mw = createHttpMetricsMiddleware(metrics);
    const req = mockReq();
    const res = mockRes(200);

    mw(req, res, jest.fn() as NextFunction);

    const midFlight = await metrics.registry.metrics();
    expect(midFlight).toMatch(/active_connections\s+1/);

    res.emit('finish');

    const after = await metrics.registry.metrics();
    expect(after).toMatch(/active_connections\s+0/);
  });

  it('decrements active_connections when client aborts (close without finish)', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const mw = createHttpMetricsMiddleware(metrics);
    const req = mockReq();
    const res = mockRes(200);

    mw(req, res, jest.fn() as NextFunction);
    res.emit('close');

    const after = await metrics.registry.metrics();
    expect(after).toMatch(/active_connections\s+0/);
  });

  it('does not double-finalize when both finish and close fire', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const mw = createHttpMetricsMiddleware(metrics);
    const req = mockReq();
    const res = mockRes(200);

    mw(req, res, jest.fn() as NextFunction);
    res.emit('finish');
    res.emit('close');

    const out = await metrics.registry.metrics();
    // Counter should be exactly 1, not 2
    expect(out).toMatch(/http_requests_total\{[^}]*\}\s+1\b/);
    // Gauge should be 0, not -1
    expect(out).toMatch(/active_connections\s+0/);
  });

  it('falls back to req.path when no route was matched (e.g., 404)', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const mw = createHttpMetricsMiddleware(metrics);
    const req = mockReq({ path: '/nonexistent' });
    const res = mockRes(404);

    mw(req, res, jest.fn() as NextFunction);
    res.emit('finish');

    const out = await metrics.registry.metrics();
    expect(out).toContain('route="/nonexistent"');
    expect(out).toContain('status_code="404"');
  });
});
