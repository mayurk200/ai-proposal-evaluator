/**
 * Rate limiting middleware.
 *
 * - `generalLimiter`: broad protection for all API routes (100 req / 15 min).
 * - `evaluateLimiter`: stricter cap for expensive evaluation endpoints
 *   (10 req / 15 min), since each request can trigger a multi-agent pipeline.
 */

import rateLimit from 'express-rate-limit';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const generalLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests, please try again later.' },
});

export const evaluateLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many evaluation requests, please try again later.',
  },
});
