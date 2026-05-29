import { Request, Response, NextFunction } from 'express';
import { correlationIdMiddleware, CORRELATION_HEADER } from './correlation-id';
import { getCorrelationId } from '../logger/correlation';

interface MockRes {
  headers: Record<string, string>;
  setHeader: jest.Mock;
}

function mockReq(headerValue?: string): Request {
  return {
    header: jest.fn((name: string) =>
      name.toLowerCase() === CORRELATION_HEADER ? headerValue : undefined,
    ),
  } as unknown as Request;
}

function mockRes(): { res: Response; sink: MockRes } {
  const headers: Record<string, string> = {};
  const setHeader = jest.fn((name: string, value: string) => {
    headers[name] = value;
  });
  const res = { setHeader, headers } as unknown as Response;
  return { res, sink: { headers, setHeader } };
}

describe('correlationIdMiddleware', () => {
  it('generates a UUID v4 when no X-Correlation-ID header is present', () => {
    const req = mockReq(undefined);
    const { res, sink } = mockRes();
    const next: NextFunction = jest.fn();

    correlationIdMiddleware(req, res, next);

    const generated = sink.headers['X-Correlation-ID'];
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses incoming X-Correlation-ID header verbatim', () => {
    const incoming = 'upstream-trace-abc-123';
    const req = mockReq(incoming);
    const { res, sink } = mockRes();
    const next: NextFunction = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(sink.headers['X-Correlation-ID']).toBe(incoming);
  });

  it('trims whitespace from incoming header and uses trimmed value', () => {
    const req = mockReq('   spaced-id   ');
    const { res, sink } = mockRes();
    const next: NextFunction = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(sink.headers['X-Correlation-ID']).toBe('spaced-id');
  });

  it('falls back to generating a UUID when incoming header is empty/whitespace', () => {
    const req = mockReq('   ');
    const { res, sink } = mockRes();
    const next: NextFunction = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(sink.headers['X-Correlation-ID']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('makes correlation_id available via AsyncLocalStorage inside next()', (done) => {
    const req = mockReq('handler-trace-1');
    const { res } = mockRes();
    const next: NextFunction = () => {
      expect(getCorrelationId()).toBe('handler-trace-1');
      done();
    };

    correlationIdMiddleware(req, res, next);
  });

  it('echoes correlation_id in the X-Correlation-ID response header', () => {
    const req = mockReq('echo-me');
    const { res, sink } = mockRes();
    const next: NextFunction = jest.fn();

    correlationIdMiddleware(req, res, next);

    expect(sink.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'echo-me');
  });

  it('isolates correlation_id between parallel requests', async () => {
    const captures: string[] = [];
    const runOne = (id: string, delay: number): Promise<void> =>
      new Promise((resolve) => {
        const req = mockReq(id);
        const { res } = mockRes();
        correlationIdMiddleware(req, res, () => {
          setTimeout(() => {
            const c = getCorrelationId();
            if (c) captures.push(c);
            resolve();
          }, delay);
        });
      });

    await Promise.all([runOne('A', 5), runOne('B', 2), runOne('C', 8)]);

    expect(captures.sort()).toEqual(['A', 'B', 'C']);
  });
});
