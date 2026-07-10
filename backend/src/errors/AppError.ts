import { ErrorCode, statusForCode, codeForStatus } from './codes';

interface AppErrorOptions {
  code?: ErrorCode;
  details?: unknown;
  /** Underlying error, kept for logging but never sent to the client. */
  cause?: unknown;
}

/**
 * Operational error with an HTTP status, a machine-readable {@link ErrorCode},
 * and optional structured `details`.
 *
 * Backward compatible: `new AppError('msg', 404)` still works and the code is
 * derived from the status. Prefer the static factories below for new code —
 * they set an explicit, meaningful code.
 */
export class AppError extends Error {
  statusCode: number;
  code: ErrorCode;
  isOperational: boolean;
  details?: unknown;
  cause?: unknown;

  constructor(message: string, statusCode = 500, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = options.code ?? codeForStatus(statusCode);
    this.details = options.details;
    this.cause = options.cause;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  /** Build from a code; the HTTP status is inferred from the code. */
  static fromCode(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(message, statusForCode(code), { code, details });
  }

  static badRequest(message = 'Bad request', details?: unknown): AppError {
    return AppError.fromCode(ErrorCode.BAD_REQUEST, message, details);
  }
  static validation(message = 'Validation error', details?: unknown): AppError {
    return AppError.fromCode(ErrorCode.VALIDATION, message, details);
  }
  static unauthorized(message = 'Unauthorized'): AppError {
    return AppError.fromCode(ErrorCode.UNAUTHORIZED, message);
  }
  static forbidden(message = 'Forbidden'): AppError {
    return AppError.fromCode(ErrorCode.FORBIDDEN, message);
  }
  static notFound(message = 'Not found'): AppError {
    return AppError.fromCode(ErrorCode.NOT_FOUND, message);
  }
  static conflict(message = 'Conflict'): AppError {
    return AppError.fromCode(ErrorCode.CONFLICT, message);
  }
  static upstream(message = 'Upstream service error', details?: unknown): AppError {
    return AppError.fromCode(ErrorCode.UPSTREAM_ERROR, message, details);
  }
  static pythonUnavailable(message = 'The processing service is unavailable'): AppError {
    return AppError.fromCode(ErrorCode.PYTHON_SERVICE_UNAVAILABLE, message);
  }
  static internal(message = 'Internal server error', cause?: unknown): AppError {
    return new AppError(message, 500, { code: ErrorCode.INTERNAL, cause });
  }
}
