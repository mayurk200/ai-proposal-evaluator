import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ErrorCode } from '../errors';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

interface JWTPayload {
  userId: string;
  role: string;
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({ status: 'error', code: ErrorCode.UNAUTHORIZED, message, error: message });
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      unauthorized(res, 'Access denied. No token provided.');
      return;
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

    req.userId = decoded.userId;
    req.userRole = decoded.role;

    next();
  } catch (error) {
    unauthorized(res, 'Invalid or expired token.');
  }
};

/**
 * Role-based access control. Must run after `authMiddleware`, which populates
 * `req.userRole` from the verified JWT.
 */
export const requireRole =
  (...roles: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({
        status: 'error',
        code: ErrorCode.FORBIDDEN,
        message: 'Insufficient privileges.',
        error: 'Insufficient privileges.',
      });
      return;
    }
    next();
  };

/** Restrict a route to ADMIN users. */
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.userRole !== 'ADMIN') {
    res.status(403).json({
      status: 'error',
      code: ErrorCode.FORBIDDEN,
      message: 'Admin privileges required.',
      error: 'Admin privileges required.',
    });
    return;
  }
  next();
};

export const optionalAuthMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

    req.userId = decoded.userId;
    req.userRole = decoded.role;

    next();
  } catch (error) {
    // Continue even if token is invalid, but don't set userId
    next();
  }
};
