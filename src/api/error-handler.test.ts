import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { createErrorHandler, notFoundHandler } from './error-handler';
import { Logger } from '../logger';
import { runWithCorrelation } from '../logger/correlation';
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  RateLimitedError,
  ForbiddenError,
} from './errors';

function silentLogger(): Logger & { calls: Array<[string, string, Record<string, unknown> | undefined]> } {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const log = (level: string) => (msg: string, meta?: Record<string, unknown>): void => {
    calls.push([level, msg, meta]);
  };
  return {
    fatal: log('fatal'),
    error: log('error'),
    warn: log('warn'),
    info: log('info'),
    debug: log('debug'),
    trace: log('trace'),
    calls,
  };
}

interface MockRes {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  headersSent: boolean;
}

function mockRes(): MockRes {
  const r: Partial<MockRes> = { headersSent: false };
  r.status = function (c) {
    (this as MockRes).statusCode = c;
    return this as MockRes;
  };
  r.json = function (b) {
    (this as MockRes).body = b;
    return this as MockRes;
  };
  return r as MockRes;
}

function mockReq(): Request {
  return { method: 'GET', originalUrl: '/api/x', url: '/api/x' } as Request;
}

describe('createErrorHandler — ApiError status mapping (AC #5)', () => {
  it('ValidationError → 400 with details', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    handler(new ValidationError([{ field: 'email', message: 'required' }]), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string; details: unknown };
    expect(body.error).toBe('validation_failed');
    expect(body.details).toEqual([{ field: 'email', message: 'required' }]);
  });

  it('UnauthorizedError → 401', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    handler(new UnauthorizedError(), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(401);
  });

  it('ForbiddenError → 403', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    handler(new ForbiddenError(), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(403);
  });

  it('NotFoundError → 404', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    handler(new NotFoundError(), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(404);
  });

  it('ConflictError → 409 with custom code', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    handler(new ConflictError('email_already_exists', 'Email taken'), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toBe('email_already_exists');
  });

  it('RateLimitedError → 429', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    handler(new RateLimitedError(60), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(429);
  });

  it('Bare ZodError → 400 with field details (defense-in-depth)', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    let zodErr: ZodError;
    try {
      z.object({ x: z.string() }).parse({ x: 7 });
      throw new Error('schema should have failed');
    } catch (e) {
      zodErr = e as ZodError;
    }
    handler(zodErr, mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('validation_failed');
  });

  it('Unknown Error → 500 with generic message (no stack leakage to client)', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    handler(new Error('internal DB exploded'), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect(res.statusCode).toBe(500);
    const body = res.body as { error: string; message: string };
    expect(body.error).toBe('internal_server_error');
    expect(body.message).not.toContain('DB exploded');
  });
});

describe('createErrorHandler — correlation ID + logging', () => {
  it('includes correlation_id in the response body when available', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    runWithCorrelation({ correlation_id: 'trace-xyz' }, () => {
      handler(new UnauthorizedError(), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    });
    expect((res.body as { correlation_id?: string }).correlation_id).toBe('trace-xyz');
  });

  it('omits correlation_id when not in a run scope', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    handler(new UnauthorizedError(), mockReq(), res as unknown as Response, jest.fn() as NextFunction);
    expect((res.body as { correlation_id?: string }).correlation_id).toBeUndefined();
  });

  it('logs 5xx errors at error level with stack trace', () => {
    const logger = silentLogger();
    const handler = createErrorHandler(logger);
    handler(new Error('boom'), mockReq(), mockRes() as unknown as Response, jest.fn() as NextFunction);
    const errorCall = logger.calls.find((c) => c[0] === 'error');
    expect(errorCall).toBeDefined();
    expect(errorCall![1]).toBe('request_failed');
    expect(errorCall![2]?.stack).toBeDefined();
  });

  it('logs 4xx errors at warn level (no stack to keep volume down)', () => {
    const logger = silentLogger();
    const handler = createErrorHandler(logger);
    handler(new ValidationError(), mockReq(), mockRes() as unknown as Response, jest.fn() as NextFunction);
    const warnCall = logger.calls.find((c) => c[0] === 'warn');
    expect(warnCall).toBeDefined();
    expect(warnCall![2]?.stack).toBeUndefined();
  });

  it('delegates to next when headersSent (response already started streaming)', () => {
    const handler = createErrorHandler(silentLogger());
    const res = mockRes();
    res.headersSent = true;
    const next = jest.fn();
    const err = new Error('mid-stream');
    handler(err, mockReq(), res as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('notFoundHandler', () => {
  it('passes a 404 ApiError to next()', () => {
    const handler = notFoundHandler();
    const next = jest.fn();
    handler(
      { method: 'GET', path: '/nope' } as Request,
      mockRes() as unknown as Response,
      next as NextFunction,
    );
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.message).toContain('GET /nope');
  });
});
