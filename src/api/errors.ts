/**
 * Tagged error types thrown by services / routes and mapped to HTTP status
 * codes by the centralized error handler. Keeping these as discrete classes
 * (rather than a single error code field) makes catch-by-type readable and
 * works well with `err instanceof X` checks across the codebase.
 *
 * The mapping policy (per AC #5):
 *   ValidationError       → 400
 *   UnauthorizedError     → 401
 *   ForbiddenError        → 403
 *   NotFoundError         → 404
 *   ConflictError         → 409
 *   RateLimitedError      → 429
 *   <anything else>       → 500
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends ApiError {
  constructor(details?: unknown) {
    super('validation_failed', 'Request validation failed', 400, details);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super('unauthorized', message, 401);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super('forbidden', message, 403);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super('not_found', message, 404);
  }
}

export class ConflictError extends ApiError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

export class RateLimitedError extends ApiError {
  constructor(retry_after_seconds?: number) {
    super('rate_limited', 'Too many requests', 429, { retry_after_seconds });
  }
}
