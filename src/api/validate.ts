import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';

export type RequestPart = 'body' | 'query' | 'params';

/**
 * Returns an Express middleware that validates the named `part` of the request
 * against a Zod schema. On success, the parsed (and possibly coerced/trimmed)
 * value REPLACES req[part] so downstream handlers see normalized data.
 * On failure, throws a ValidationError which the centralized error handler
 * formats as 400 with structured field errors (AC #4).
 *
 * Why throw instead of writing the response here:
 *   Centralized error handling (AC #5) reads better when every error response
 *   flows through one place. Routes can call multiple validators (body +
 *   query + params); throwing keeps the chain short-circuiting clean.
 */
import { ValidationError } from './errors';

export function validate<T>(schema: ZodSchema<T>, part: RequestPart = 'body') {
  return function validateMiddleware(req: Request, _res: Response, next: NextFunction): void {
    const source = (req as Request & Record<string, unknown>)[part];
    try {
      const parsed = schema.parse(source);
      (req as Request & Record<string, unknown>)[part] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(
          new ValidationError(
            err.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            })),
          ),
        );
        return;
      }
      next(err);
    }
  };
}
