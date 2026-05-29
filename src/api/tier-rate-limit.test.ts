import { EventEmitter } from 'node:events';
import { Request, Response, NextFunction } from 'express';
import { createTierRateLimitMiddleware } from './tier-rate-limit';
import { InMemoryRateLimitHelper } from '../redis';
import { AuthenticatedUser } from '../auth';

function buildReq(user?: AuthenticatedUser): Request {
  return { user } as unknown as Request;
}

type MockRes = Response & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
};

function buildRes(): MockRes {
  const emitter = new EventEmitter() as EventEmitter & Partial<Response>;
  const headers: Record<string, string> = {};
  const r = emitter as unknown as MockRes;
  r.headers = headers;
  r.setHeader = ((name: string, value: string | number): MockRes => {
    headers[name] = String(value);
    return r;
  }) as MockRes['setHeader'];
  r.status = ((code: number): MockRes => {
    r.statusCode = code;
    return r;
  }) as MockRes['status'];
  r.json = ((body: unknown): MockRes => {
    r.body = body;
    return r;
  }) as MockRes['json'];
  return r;
}

const FREE_USER: AuthenticatedUser = { id: 'u-free', email: 'f@test.com', tier: 'free' };
const PRO_USER: AuthenticatedUser = { id: 'u-pro', email: 'p@test.com', tier: 'pro' };

describe('createTierRateLimitMiddleware — header writes (AC #5)', () => {
  it('sets X-RateLimit-Limit/Remaining/Reset on every authenticated request', async () => {
    const mw = createTierRateLimitMiddleware({
      rateLimitHelper: new InMemoryRateLimitHelper(),
      action: 'api',
    });
    const req = buildReq(FREE_USER);
    const res = buildRes();
    await mw(req, res, jest.fn() as NextFunction);

    expect(res.headers['X-RateLimit-Limit']).toBe('30');
    expect(res.headers['X-RateLimit-Remaining']).toBe('29');
    expect(res.headers['X-RateLimit-Reset']).toMatch(/^\d+$/);
  });

  it('renders unlimited tiers (Pro capture) with the string "unlimited"', async () => {
    const mw = createTierRateLimitMiddleware({
      rateLimitHelper: new InMemoryRateLimitHelper(),
      action: 'capture',
    });
    const res = buildRes();
    await mw(buildReq(PRO_USER), res, jest.fn() as NextFunction);

    expect(res.headers['X-RateLimit-Limit']).toBe('unlimited');
    expect(res.headers['X-RateLimit-Remaining']).toBe('unlimited');
  });
});

describe('createTierRateLimitMiddleware — limit enforcement (AC #1-4)', () => {
  it('Free tier capture: allows 20 then 429 on 21st (AC #9 integration)', async () => {
    const helper = new InMemoryRateLimitHelper();
    const mw = createTierRateLimitMiddleware({ rateLimitHelper: helper, action: 'capture' });

    for (let i = 0; i < 20; i += 1) {
      const res = buildRes();
      await mw(buildReq(FREE_USER), res, jest.fn() as NextFunction);
      expect(res.statusCode).toBeUndefined(); // next() called, no 429
    }

    const blocked = buildRes();
    await mw(buildReq(FREE_USER), blocked, jest.fn() as NextFunction);
    expect(blocked.statusCode).toBe(429);
    expect((blocked.body as { error: string }).error).toBe('Daily capture limit reached');
    expect((blocked.body as { limit: number }).limit).toBe(20);
    expect((blocked.body as { remaining: number }).remaining).toBe(0);
    expect(blocked.headers['Retry-After']).toMatch(/^\d+$/);
  });

  it('Free tier API: blocks the 31st request', async () => {
    const helper = new InMemoryRateLimitHelper();
    const mw = createTierRateLimitMiddleware({ rateLimitHelper: helper, action: 'api' });

    let lastStatus: number | undefined;
    for (let i = 0; i < 31; i += 1) {
      const res = buildRes();
      await mw(buildReq(FREE_USER), res, jest.fn() as NextFunction);
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });

  it('Pro tier API: blocks the 101st request', async () => {
    const helper = new InMemoryRateLimitHelper();
    const mw = createTierRateLimitMiddleware({ rateLimitHelper: helper, action: 'api' });

    let lastStatus: number | undefined;
    for (let i = 0; i < 101; i += 1) {
      const res = buildRes();
      await mw(buildReq(PRO_USER), res, jest.fn() as NextFunction);
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  });

  it('Pro tier capture: never blocks (unlimited)', async () => {
    const helper = new InMemoryRateLimitHelper();
    const mw = createTierRateLimitMiddleware({ rateLimitHelper: helper, action: 'capture' });

    for (let i = 0; i < 50; i += 1) {
      const res = buildRes();
      await mw(buildReq(PRO_USER), res, jest.fn() as NextFunction);
      expect(res.statusCode).toBeUndefined();
    }
  });

  it('429 body includes ISO 8601 reset_at timestamp', async () => {
    const helper = new InMemoryRateLimitHelper();
    const mw = createTierRateLimitMiddleware({ rateLimitHelper: helper, action: 'capture' });

    for (let i = 0; i < 20; i += 1) {
      await mw(buildReq(FREE_USER), buildRes(), jest.fn() as NextFunction);
    }
    const blocked = buildRes();
    await mw(buildReq(FREE_USER), blocked, jest.fn() as NextFunction);

    expect((blocked.body as { reset_at: string }).reset_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});

describe('createTierRateLimitMiddleware — skip behavior', () => {
  it('passes through unauthenticated requests (no req.user)', async () => {
    const mw = createTierRateLimitMiddleware({
      rateLimitHelper: new InMemoryRateLimitHelper(),
      action: 'api',
    });
    const next = jest.fn();
    const res = buildRes();
    await mw(buildReq(undefined), res, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
    expect(res.headers['X-RateLimit-Limit']).toBeUndefined();
  });

  it('forwards rate-limiter errors to error handler (fail open via next(err))', async () => {
    const breakingHelper = {
      now: Date.now,
      checkRateLimit: async () => {
        throw new Error('redis down');
      },
    };
    const mw = createTierRateLimitMiddleware({ rateLimitHelper: breakingHelper, action: 'api' });
    const next = jest.fn();
    await mw(buildReq(FREE_USER), buildRes(), next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('honors custom exceededMessage', async () => {
    const helper = new InMemoryRateLimitHelper();
    const mw = createTierRateLimitMiddleware({
      rateLimitHelper: helper,
      action: 'api',
      exceededMessage: 'Slow down, partner',
    });
    for (let i = 0; i < 30; i += 1) {
      await mw(buildReq(FREE_USER), buildRes(), jest.fn() as NextFunction);
    }
    const blocked = buildRes();
    await mw(buildReq(FREE_USER), blocked, jest.fn() as NextFunction);
    expect((blocked.body as { error: string }).error).toBe('Slow down, partner');
  });
});
