import { Request, Response, NextFunction } from 'express';
import { authService, sha256, AuthResult } from './auth.service';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  uuidSchema,
} from './auth.schema';
import { AuthRequest } from '../../middleware/auth';
import { env, cookieSecure } from '../../config/env';
import { RequestContext } from './auth.db';

const REFRESH_COOKIE = 'agrieval_rt';
// Scoped to the auth routes so the refresh token is never sent anywhere else.
const COOKIE_PATH = '/api/auth';

function requestContext(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/** Parse a cookie without pulling in cookie-parser for one value. */
function getRefreshCookie(req: Request): string | null {
  const match = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${REFRESH_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: env.JWT_REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: cookieSecure, sameSite: 'lax', path: COOKIE_PATH });
}

/** Send an auth result: refresh token goes into the HttpOnly cookie, never the body. */
function sendAuth(res: Response, result: AuthResult, status = 200): void {
  setRefreshCookie(res, result.refreshToken);
  res.status(status).json({ status: 'success', data: { user: result.user, token: result.token } });
}

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const data = registerSchema.parse(req.body);
      const result = await authService.register(data, requestContext(req));
      sendAuth(res, result, 201);
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = loginSchema.parse(req.body);
      const result = await authService.login(data, requestContext(req));
      sendAuth(res, result);
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = getRefreshCookie(req);
      if (!raw) {
        res.status(401).json({
          status: 'error',
          code: 'UNAUTHORIZED',
          message: 'No refresh token provided',
          error: 'No refresh token provided',
        });
        return;
      }
      const result = await authService.refresh(raw, requestContext(req));
      sendAuth(res, result);
    } catch (error) {
      clearRefreshCookie(res);
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.logout(getRefreshCookie(req), requestContext(req));
      clearRefreshCookie(res);
      res.json({ status: 'success', data: { message: 'Logged out' } });
    } catch (error) {
      next(error);
    }
  }

  async logoutAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.logoutAll(req.userId!, requestContext(req));
      clearRefreshCookie(res);
      res.json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await authService.getProfile(req.userId!);
      res.json({ status: 'success', data: user });
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = changePasswordSchema.parse(req.body);
      const raw = getRefreshCookie(req);
      await authService.changePassword(req.userId!, data, raw ? sha256(raw) : null, requestContext(req));
      res.json({ status: 'success', data: { message: 'Password changed' } });
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      const token = await authService.forgotPassword(email, requestContext(req));
      // Identical response whether or not the email exists (no enumeration).
      // Without an SMTP integration the token can't be emailed, so expose it
      // in development only to make the flow testable.
      res.json({
        status: 'success',
        data: {
          message: 'If that email is registered, password reset instructions have been sent.',
          ...(env.NODE_ENV === 'development' && token ? { devResetToken: token } : {}),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const data = resetPasswordSchema.parse(req.body);
      await authService.resetPassword(data, requestContext(req));
      res.json({ status: 'success', data: { message: 'Password has been reset. Please sign in.' } });
    } catch (error) {
      next(error);
    }
  }

  async listSessions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const raw = getRefreshCookie(req);
      const sessions = await authService.listSessions(req.userId!, raw ? sha256(raw) : null);
      res.json({ status: 'success', data: sessions });
    } catch (error) {
      next(error);
    }
  }

  async revokeSession(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const sessionId = uuidSchema.parse(req.params.id);
      await authService.revokeSession(req.userId!, sessionId, requestContext(req));
      res.json({ status: 'success', data: { message: 'Session revoked' } });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
