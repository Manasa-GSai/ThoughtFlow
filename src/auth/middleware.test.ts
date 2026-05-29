import { Request, Response, NextFunction } from 'express';
import { JwtService } from './jwt-service';
import { createRequireAuthMiddleware } from './middleware';
import { getCorrelationContext, runWithCorrelation } from '../logger/correlation';

function buildJwt(): JwtService {
  return new JwtService({
    access_token_secret: 'a',
    refresh_token_secret: 'r',
  });
}

function mockReq(headerValue: string | undefined): Request {
  return {
    header: jest.fn((name: string) => {
      if (name.toLowerCase() === 'authorization') return headerValue;
      return undefined;
    }),
  } as unknown as Request;
}

type MockedRes = Response & {
  body: unknown;
  code: number;
  status: jest.Mock;
  json: jest.Mock;
};

function mockRes(): MockedRes {
  const r = {} as MockedRes;
  r.status = jest.fn((c: number) => {
    r.code = c;
    return r;
  }) as unknown as MockedRes['status'];
  r.json = jest.fn((b: unknown) => {
    r.body = b;
    return r;
  }) as unknown as MockedRes['json'];
  return r;
}

describe('createRequireAuthMiddleware', () => {
  it('rejects missing Authorization header with 401', () => {
    const mw = createRequireAuthMiddleware(buildJwt());
    const req = mockReq(undefined);
    const res = mockRes();
    const next: NextFunction = jest.fn();

    mw(req, res, next);

    expect(res.code).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects non-Bearer scheme with 401', () => {
    const mw = createRequireAuthMiddleware(buildJwt());
    const req = mockReq('Basic dXNlcjpwYXNz');
    const res = mockRes();

    mw(req, res, jest.fn() as NextFunction);

    expect(res.code).toBe(401);
  });

  it('rejects empty token after Bearer with 401', () => {
    const mw = createRequireAuthMiddleware(buildJwt());
    const req = mockReq('Bearer    ');
    const res = mockRes();

    mw(req, res, jest.fn() as NextFunction);

    expect(res.code).toBe(401);
  });

  it('rejects invalid/expired JWT with 401', () => {
    const mw = createRequireAuthMiddleware(buildJwt());
    const req = mockReq('Bearer not.a.valid.jwt');
    const res = mockRes();

    mw(req, res, jest.fn() as NextFunction);

    expect(res.code).toBe(401);
  });

  it('passes through valid token, attaches req.user and calls next', () => {
    const jwt = buildJwt();
    const mw = createRequireAuthMiddleware(jwt);
    const { token } = jwt.signAccess({ sub: 'u-1', email: 'a@b.com', tier: 'free' });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ id: 'u-1', email: 'a@b.com', tier: 'free' });
    expect((res.status as jest.Mock)).not.toHaveBeenCalled();
  });

  it('pushes user_id into the correlation context for downstream logs', () => {
    const jwt = buildJwt();
    const mw = createRequireAuthMiddleware(jwt);
    const { token } = jwt.signAccess({ sub: 'u-99', email: 'a@b.com', tier: 'pro' });

    runWithCorrelation({ correlation_id: 'c1' }, () => {
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      mw(req, res, jest.fn() as NextFunction);
      expect(getCorrelationContext()?.user_id).toBe('u-99');
    });
  });

  it('rejects token signed by a different access secret with 401', () => {
    const mw = createRequireAuthMiddleware(buildJwt());
    const other = new JwtService({
      access_token_secret: 'different-secret',
      refresh_token_secret: 'r',
    });
    const { token } = other.signAccess({ sub: 'u', email: 'a@b.com', tier: 'free' });

    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();

    mw(req, res, jest.fn() as NextFunction);
    expect(res.code).toBe(401);
  });
});
