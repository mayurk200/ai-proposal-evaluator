/**
 * Rate limiting middleware.
 *
 * - `generalLimiter`: broad protection for all API routes (100 req / 15 min).
 * - `authLimiter`: brute-force protection for credential endpoints
 *   (20 failed req / 15 min per IP; successful requests don't count).
 * - `evaluateLimiter`: stricter cap for expensive evaluation endpoints
 *   (10 req / 15 min), since each request can trigger a multi-agent pipeline.
 */

import rateLimit from 'express-rate-limit';
import { ErrorCode } from '../errors';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// 429 responses are emitted by express-rate-limit directly, so they carry the
// same unified error contract (status/code/message/error) as everything else.
const rateLimitBody = (message: string) => ({
  status: 'error' as const,
  code: ErrorCode.RATE_LIMITED,
  message,
  error: message,
});

export const generalLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitBody('Too many requests, please try again later.'),
});

// Brute-force backstop for credential endpoints (login/register/password
// reset). Successful requests don't count, so normal use is unaffected; the
// per-account lockout in the auth service handles targeted attacks.
export const authLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitBody('Too many attempts. Please try again later.'),
});

export const evaluateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitBody('Too many evaluation requests, please try again later.'),
});
