import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '../modules/auth/auth.service';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: Role;
}

interface JWTPayload {
  userId: string;
  role: Role;
}

/**
 * Require a valid token.
 *
 * There is no `optionalAuthMiddleware` any more. Every route in this system —
 * uploads, proposals, evaluations, decisions — was previously reachable
 * anonymously, because the old middleware waved through requests with no token
 * and the controllers then treated `userId = null` as "anonymous owner". For a
 * console that records who approved which funding decision, unauthenticated
 * access is not a mode we want to have.
 */
export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ status: 'error', message: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), env.JWT_SECRET) as JWTPayload;
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch {
    res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
};

/**
 * Restrict a route to specific roles. Must run after `authMiddleware`.
 *
 * ADMIN owns the irreversible calls: resolving the duplicate-idea gate,
 * approving/rejecting an idea, and marking one selected for funding. DESK2 can
 * upload, process and read everything, but cannot decide.
 */
export const requireRole = (...roles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole) {
      res.status(401).json({ status: 'error', message: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.userRole)) {
      res.status(403).json({
        status: 'error',
        message: `Requires one of: ${roles.join(', ')}`,
      });
      return;
    }
    next();
  };
};
