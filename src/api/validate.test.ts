import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from './validate';
import { ValidationError } from './errors';

function buildReq(part: 'body' | 'query' | 'params', value: unknown): Request {
  const req = { body: {}, query: {}, params: {} } as unknown as Request;
  (req as unknown as Record<string, unknown>)[part] = value;
  return req;
}

describe('validate() middleware', () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().int().min(0),
  });

  it('passes through valid body and parses normalized value back onto req', () => {
    const mw = validate(schema);
    const req = buildReq('body', { email: 'a@b.com', age: 21 });
    const next = jest.fn();

    mw(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ email: 'a@b.com', age: 21 });
  });

  it('passes ValidationError with field-level details on failure', () => {
    const mw = validate(schema);
    const req = buildReq('body', { email: 'not-an-email', age: -1 });
    const next = jest.fn();

    mw(req, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.status).toBe(400);
    const details = err.details as Array<{ field: string; message: string }>;
    expect(details.some((d) => d.field === 'email')).toBe(true);
    expect(details.some((d) => d.field === 'age')).toBe(true);
  });

  it('validates query when configured for "query"', () => {
    const querySchema = z.object({ q: z.string().min(1) });
    const mw = validate(querySchema, 'query');
    const req = buildReq('query', { q: '' });
    const next = jest.fn();

    mw(req, {} as Response, next as NextFunction);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
  });

  it('validates params when configured for "params"', () => {
    const paramSchema = z.object({ id: z.string().uuid() });
    const mw = validate(paramSchema, 'params');
    const req = buildReq('params', { id: 'not-a-uuid' });
    const next = jest.fn();

    mw(req, {} as Response, next as NextFunction);

    const err = (next as jest.Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(ValidationError);
  });

  it('forwards non-Zod errors via next() unchanged', () => {
    const throwing = {
      parse: () => {
        throw new Error('boom');
      },
    } as unknown as z.ZodSchema;
    const mw = validate(throwing);
    const req = buildReq('body', {});
    const next = jest.fn();

    mw(req, {} as Response, next as NextFunction);

    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next as jest.Mock).mock.calls[0][0]).not.toBeInstanceOf(ValidationError);
  });
});
