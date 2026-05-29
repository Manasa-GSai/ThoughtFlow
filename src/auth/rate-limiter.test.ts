import { EventEmitter } from 'node:events';
import { Request, Response, NextFunction } from 'express';
import {
  InMemoryRateLimiterStore,
  createRateLimitMiddleware,
} from './rate-limiter';

function mockReq(ip = '127.0.0.1'): Request {
  return { ip } as Request;
}

function mockRes(): Response & {
  body: unknown;
  code: number;
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  finished: boolean;
} {
  const emitter = new EventEmitter() as EventEmitter & Partial<Response>;
  const headers: Record<string, string> = {};
  const r = emitter as unknown as Response & {
    body: unknown;
    code: number;
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
    finished: boolean;
  };
  r.status = jest.fn((c: number) => {
    r.code = c;
    return r;
  }) as unknown as typeof r.status;
  r.json = jest.fn((b: unknown) => {
    r.body = b;
    return r;
  }) as unknown as typeof r.json;
  r.setHeader = jest.fn((name: string, value: string) => {
    headers[name] = value;
    return r;
  }) as unknown as typeof r.setHeader;
  return r;
}

describe('InMemoryRateLimiterStore', () => {
  it('increments within the same window', async () => {
    const store = new InMemoryRateLimiterStore();
    expect(await store.hit('k', 60_000)).toBe(1);
    expect(await store.hit('k', 60_000)).toBe(2);
    expect(await store.hit('k', 60_000)).toBe(3);
  });

  it('resets to 1 when the window has elapsed', async () => {
    const store = new InMemoryRateLimiterStore();
    await store.hit('k', 1); // 1ms window
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.hit('k', 60_000)).toBe(1);
  });

  it('isolates buckets by key', async () => {
    const store = new InMemoryRateLimiterStore();
    expect(await store.hit('a', 60_000)).toBe(1);
    expect(await store.hit('b', 60_000)).toBe(1);
  });
});

describe('createRateLimitMiddleware', () => {
  it('passes through under the limit', async () => {
    const store = new InMemoryRateLimiterStore();
    const mw = createRateLimitMiddleware({ store, scope: 'login', max: 3, window_ms: 60_000 });
    const next = jest.fn();
    const res = mockRes();

    for (let i = 0; i < 3; i += 1) {
      await mw(mockReq(), res, next as NextFunction);
    }

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks the (max+1)th request with 429 + Retry-After header', async () => {
    const store = new InMemoryRateLimiterStore();
    const mw = createRateLimitMiddleware({ store, scope: 'login', max: 2, window_ms: 60_000 });
    const next = jest.fn();
    const res = mockRes();

    await mw(mockReq(), res, next as NextFunction);
    await mw(mockReq(), res, next as NextFunction);
    await mw(mockReq(), res, next as NextFunction); // over limit

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.code).toBe(429);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(res.body).toMatchObject({ error: 'rate_limited' });
  });

  it('isolates rate-limit buckets across scopes (login vs register share IP but not bucket)', async () => {
    const store = new InMemoryRateLimiterStore();
    const loginMw = createRateLimitMiddleware({
      store,
      scope: 'login',
      max: 5,
      window_ms: 60_000,
    });
    const registerMw = createRateLimitMiddleware({
      store,
      scope: 'register',
      max: 3,
      window_ms: 60_000,
    });

    for (let i = 0; i < 5; i += 1) {
      await loginMw(mockReq('1.2.3.4'), mockRes(), jest.fn() as NextFunction);
    }

    // Register should still have a full budget.
    const res = mockRes();
    await registerMw(mockReq('1.2.3.4'), res, jest.fn() as NextFunction);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('isolates rate-limit buckets across IPs', async () => {
    const store = new InMemoryRateLimiterStore();
    const mw = createRateLimitMiddleware({ store, scope: 'login', max: 1, window_ms: 60_000 });

    await mw(mockReq('1.1.1.1'), mockRes(), jest.fn() as NextFunction);
    const res2 = mockRes();
    await mw(mockReq('2.2.2.2'), res2, jest.fn() as NextFunction);
    expect(res2.status).not.toHaveBeenCalled();
  });

  it('falls back to "unknown" when req.ip is undefined', async () => {
    const store = new InMemoryRateLimiterStore();
    const mw = createRateLimitMiddleware({ store, scope: 'login', max: 1, window_ms: 60_000 });
    const req = { ip: undefined } as unknown as Request;

    await mw(req, mockRes(), jest.fn() as NextFunction);
    const res2 = mockRes();
    await mw(req, res2, jest.fn() as NextFunction); // 2nd hit on "unknown" bucket
    expect(res2.code).toBe(429);
  });
});
