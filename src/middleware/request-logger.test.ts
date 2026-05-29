import { EventEmitter } from 'node:events';
import { Request, Response, NextFunction } from 'express';
import { createRequestLoggerMiddleware } from './request-logger';
import { Logger } from '../logger/logger';
import { runWithCorrelation } from '../logger/correlation';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    originalUrl: '/api/thoughts',
    url: '/api/thoughts',
    ...overrides,
  } as Request;
}

function mockRes(statusCode = 200): Response & EventEmitter {
  const emitter = new EventEmitter() as EventEmitter & Partial<Response>;
  emitter.statusCode = statusCode;
  return emitter as Response & EventEmitter;
}

function mockLogger(): Logger & { calls: Array<[string, Record<string, unknown> | undefined]> } {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const record = (msg: string, meta?: Record<string, unknown>): void => {
    calls.push([msg, meta]);
  };
  return {
    fatal: record,
    error: record,
    warn: record,
    info: record,
    debug: record,
    trace: record,
    calls,
  };
}

describe('createRequestLoggerMiddleware', () => {
  it('logs request_completed once the response finishes', () => {
    const logger = mockLogger();
    const mw = createRequestLoggerMiddleware(logger);
    const req = mockReq();
    const res = mockRes(200);
    const next: NextFunction = jest.fn();

    mw(req, res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.calls).toHaveLength(1);
    const [msg, meta] = logger.calls[0];
    expect(msg).toBe('request_completed');
    expect(meta?.method).toBe('GET');
    expect(meta?.path).toBe('/api/thoughts');
    expect(meta?.status_code).toBe(200);
  });

  it('captures response_time_ms as a non-negative number', () => {
    const logger = mockLogger();
    const mw = createRequestLoggerMiddleware(logger);
    const req = mockReq();
    const res = mockRes(201);

    mw(req, res, jest.fn());
    res.emit('finish');

    const [, meta] = logger.calls[0];
    expect(typeof meta?.response_time_ms).toBe('number');
    expect(meta?.response_time_ms as number).toBeGreaterThanOrEqual(0);
  });

  it('does NOT log before the response finishes', () => {
    const logger = mockLogger();
    const mw = createRequestLoggerMiddleware(logger);
    const req = mockReq();
    const res = mockRes(500);

    mw(req, res, jest.fn());

    expect(logger.calls).toHaveLength(0);
  });

  it('captures status_code from res.statusCode at finish time', () => {
    const logger = mockLogger();
    const mw = createRequestLoggerMiddleware(logger);
    const req = mockReq();
    const res = mockRes(200);

    mw(req, res, jest.fn());
    res.statusCode = 404;
    res.emit('finish');

    const [, meta] = logger.calls[0];
    expect(meta?.status_code).toBe(404);
  });

  it('includes user_id when req.user is populated by upstream auth', () => {
    const logger = mockLogger();
    const mw = createRequestLoggerMiddleware(logger);
    const req = mockReq({ user: { id: 'user-99' } } as unknown as Partial<Request>);
    const res = mockRes(200);

    mw(req as Request, res, jest.fn());
    res.emit('finish');

    const [, meta] = logger.calls[0];
    expect(meta?.user_id).toBe('user-99');
  });

  it('falls back to user_id from correlation context when req.user is absent', () => {
    const logger = mockLogger();
    const mw = createRequestLoggerMiddleware(logger);
    const req = mockReq();
    const res = mockRes(200);

    runWithCorrelation({ correlation_id: 'c1', user_id: 'ctx-user-7' }, () => {
      mw(req, res, jest.fn());
      res.emit('finish');
    });

    const [, meta] = logger.calls[0];
    expect(meta?.user_id).toBe('ctx-user-7');
  });

  it('omits user_id when neither req.user nor ctx has one (unauthenticated route)', () => {
    const logger = mockLogger();
    const mw = createRequestLoggerMiddleware(logger);
    const req = mockReq();
    const res = mockRes(200);

    mw(req, res, jest.fn());
    res.emit('finish');

    const [, meta] = logger.calls[0];
    expect(meta).not.toHaveProperty('user_id');
  });

  it('prefers req.url when originalUrl is absent', () => {
    const logger = mockLogger();
    const mw = createRequestLoggerMiddleware(logger);
    const req = { method: 'POST', url: '/x', originalUrl: undefined } as unknown as Request;
    const res = mockRes(200);

    mw(req, res, jest.fn());
    res.emit('finish');

    const [, meta] = logger.calls[0];
    expect(meta?.path).toBe('/x');
  });
});
