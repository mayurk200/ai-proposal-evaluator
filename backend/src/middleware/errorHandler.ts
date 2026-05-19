import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err: Error | AppError, _req: Request, res: Response, _next: NextFunction): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
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
