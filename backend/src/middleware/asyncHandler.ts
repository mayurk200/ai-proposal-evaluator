import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler so a rejected promise is forwarded to the
 * central error handler instead of crashing the process or hanging the request.
 *
 * Usage: `router.get('/x', asyncHandler(async (req, res) => { ... }))`.
 * Existing hand-rolled `try/catch … next(error)` handlers keep working; this is
 * the preferred pattern for new routes.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
