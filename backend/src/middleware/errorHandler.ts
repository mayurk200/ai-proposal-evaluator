import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode, codeForStatus } from '../errors';
import { logger, getRequestId } from '../utils/logger';

// Re-export so existing `import { AppError } from '../../middleware/errorHandler'`
// call sites keep working now that AppError lives in ../errors.
export { AppError };

/** Shape sent to the client for every error. Mirrored by the Python service. */
export interface ErrorResponseBody {
  status: 'error';
  code: ErrorCode;
  message: string;
  requestId?: string;
  /** Legacy alias for `message` — some frontend readers check `error` first. */
  error: string;
  details?: unknown;
}

/**
 * Optional sinks notified about every handled error (e.g. persist to the DB
 * error log in Step 5). Reporters must never throw; failures are swallowed so a
 * broken reporter can't turn one error into two.
 */
export interface ErrorReport {
  code: ErrorCode;
  statusCode: number;
  message: string;
  requestId?: string;
  method: string;
  path: string;
  stack?: string;
  isOperational: boolean;
  details?: unknown;
}
type ErrorReporter = (report: ErrorReport) => void | Promise<void>;
const reporters: ErrorReporter[] = [];
export function registerErrorReporter(reporter: ErrorReporter): void {
  reporters.push(reporter);
}

/** Normalise any thrown value into a code + status + client-safe message. */
function normalize(err: unknown): { code: ErrorCode; statusCode: number; message: string; details?: unknown } {
  if (err instanceof AppError) {
    return { code: err.code, statusCode: err.statusCode, message: err.message, details: err.details };
  }

  const e = err as { name?: string; message?: string; statusCode?: number; status?: number; issues?: unknown; type?: string };

  // Zod validation errors
  if (e?.name === 'ZodError') {
    const issues = (e as any).issues as Array<{ path: (string | number)[]; message: string }> | undefined;
    const first = issues?.[0];
    const message = first ? `${first.path.join('.')}: ${first.message}` : 'Validation error';
    return { code: ErrorCode.VALIDATION, statusCode: 400, message, details: issues };
  }

  // Multer upload errors
  if (e?.name === 'MulterError') {
    const tooLarge = (e as any).code === 'LIMIT_FILE_SIZE';
    return {
      code: tooLarge ? ErrorCode.PAYLOAD_TOO_LARGE : ErrorCode.UPLOAD_FAILED,
      statusCode: tooLarge ? 413 : 400,
      message: e.message || 'File upload error',
    };
  }

  // Malformed JSON body (body-parser)
  if (e?.type === 'entity.parse.failed' || (e?.name === 'SyntaxError' && 'body' in (err as object))) {
    return { code: ErrorCode.BAD_REQUEST, statusCode: 400, message: 'Malformed JSON in request body' };
  }
  if (e?.type === 'entity.too.large') {
    return { code: ErrorCode.PAYLOAD_TOO_LARGE, statusCode: 413, message: 'Request payload too large' };
  }

  // An explicit status on an otherwise-unknown error is respected.
  const status = typeof e?.statusCode === 'number' ? e.statusCode : typeof e?.status === 'number' ? e.status : 500;
  if (status && status !== 500) {
    return { code: codeForStatus(status), statusCode: status, message: e?.message || 'Request failed' };
  }

  return { code: ErrorCode.INTERNAL, statusCode: 500, message: e?.message || 'Internal server error' };
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const { code, statusCode, message, details } = normalize(err);
  const requestId = req.requestId ?? getRequestId();
  const isOperational = err instanceof AppError ? err.isOperational : statusCode < 500;

  // Log: 5xx at error level (with stack), 4xx at warn level.
  const logFields = {
    code,
    status: statusCode,
    message,
    ...(statusCode >= 500 ? { stack: err.stack } : {}),
  };
  if (statusCode >= 500) logger.error('request_failed', logFields);
  else logger.warn('request_rejected', logFields);

  // Fan out to registered reporters (DB error log, etc.) — best effort.
  const report: ErrorReport = {
    code,
    statusCode,
    message,
    requestId,
    method: req.method,
    path: req.originalUrl,
    stack: err.stack,
    isOperational,
    details,
  };
  for (const reporter of reporters) {
    try {
      Promise.resolve(reporter(report)).catch((e) => logger.warn('error_reporter_failed', { reason: String(e) }));
    } catch (e) {
      logger.warn('error_reporter_failed', { reason: String(e) });
    }
  }

  if (res.headersSent) return; // Delegate to Express if the response already started.

  // Never leak internal 5xx messages/stacks to clients in production.
  const clientMessage =
    statusCode >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : message;

  const body: ErrorResponseBody = {
    status: 'error',
    code,
    message: clientMessage,
    error: clientMessage,
    ...(requestId ? { requestId } : {}),
    ...(details !== undefined ? { details } : {}),
  };

  res.status(statusCode).json(body);
};
