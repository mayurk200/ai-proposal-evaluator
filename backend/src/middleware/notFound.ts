import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors';

/**
 * Terminal handler for unmatched routes. Registered after all routes and before
 * the error handler so a bad path yields the same structured error envelope as
 * everything else instead of Express's default HTML 404.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}
