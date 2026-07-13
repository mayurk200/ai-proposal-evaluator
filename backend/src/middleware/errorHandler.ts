import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  /**
   * Structured payload travelling with the error.
   *
   * Some failures are not just a sentence. Approving an idea into a category that
   * already has one returns 409 with the *list* of conflicting approvals, so the UI can
   * show the evaluator exactly which other idea holds that slot and what else the
   * company has already won. Flattening that to a string would throw away the only part
   * they need in order to decide.
   */
  details?: unknown;

  constructor(message: string, statusCode: number = 500, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err: Error | AppError, _req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // Multer errors
  if (err.name === 'MulterError') {
    res.status(400).json({
      status: 'error',
      message: err.message,
    });
    return;
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    const zodErr = err as any;
    const firstIssue = zodErr.issues?.[0];
    const message = firstIssue
      ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
      : 'Validation error';
    res.status(400).json({
      status: 'error',
      message,
      errors: zodErr.issues,
    });
    return;
  }

  console.error('Unhandled error:', err);

  res.status(500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
};
