import {
  ApiError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitedError,
} from './errors';

describe('ApiError hierarchy', () => {
  it('ValidationError → 400 with details', () => {
    const e = new ValidationError([{ field: 'email', message: 'required' }]);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(400);
    expect(e.code).toBe('validation_failed');
    expect(e.details).toEqual([{ field: 'email', message: 'required' }]);
  });

  it('UnauthorizedError → 401', () => {
    const e = new UnauthorizedError();
    expect(e.status).toBe(401);
    expect(e.code).toBe('unauthorized');
  });

  it('ForbiddenError → 403', () => {
    expect(new ForbiddenError().status).toBe(403);
  });

  it('NotFoundError → 404', () => {
    const e = new NotFoundError('Thought 7 not found');
    expect(e.status).toBe(404);
    expect(e.message).toBe('Thought 7 not found');
  });

  it('ConflictError → 409 with custom code', () => {
    const e = new ConflictError('email_already_exists', 'Email taken');
    expect(e.status).toBe(409);
    expect(e.code).toBe('email_already_exists');
  });

  it('RateLimitedError → 429 with retry_after_seconds in details', () => {
    const e = new RateLimitedError(60);
    expect(e.status).toBe(429);
    expect(e.details).toEqual({ retry_after_seconds: 60 });
  });

  it('every subclass is instanceof ApiError', () => {
    expect(new ValidationError()).toBeInstanceOf(ApiError);
    expect(new UnauthorizedError()).toBeInstanceOf(ApiError);
    expect(new ForbiddenError()).toBeInstanceOf(ApiError);
    expect(new NotFoundError()).toBeInstanceOf(ApiError);
    expect(new ConflictError('x', 'y')).toBeInstanceOf(ApiError);
    expect(new RateLimitedError()).toBeInstanceOf(ApiError);
  });
});
