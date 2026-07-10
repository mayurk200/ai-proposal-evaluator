import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext, logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request, echoed back as the X-Request-Id header. */
      requestId: string;
    }
  }
}

/**
 * Assigns a correlation id to every request and binds it to the async context
 * so all downstream logs (and the error handler) can reference it.
 *
 * Honours an inbound `X-Request-Id` header so a trace can span services — e.g.
 * the same id is forwarded to the Python service (Step 3).
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  const requestId = inbound && inbound.length <= 200 ? inbound : randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  runWithRequestContext({ requestId, method: req.method, path: req.originalUrl }, () => {
    const start = Date.now();
    res.on('finish', () => {
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level]('request_completed', {
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  });
}
