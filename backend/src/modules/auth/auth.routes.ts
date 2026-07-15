import { Router } from 'express';
import { authController } from './auth.controller';
import { authMiddleware } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';

const router = Router();

// Credential endpoints get the stricter per-IP limiter on top of the
// per-account lockout enforced by the service.
router.post('/register', authLimiter, (req, res, next) => authController.register(req, res, next));
router.post('/login', authLimiter, (req, res, next) => authController.login(req, res, next));
router.post('/forgot-password', authLimiter, (req, res, next) => authController.forgotPassword(req, res, next));
router.post('/reset-password', authLimiter, (req, res, next) => authController.resetPassword(req, res, next));

// Session lifecycle — refresh/logout authenticate via the HttpOnly refresh
// cookie itself, so they work even after the access token has expired.
router.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));
router.post('/logout-all', authMiddleware, (req, res, next) => authController.logoutAll(req, res, next));

// Authenticated account endpoints.
router.get('/me', authMiddleware, (req, res, next) => authController.getProfile(req, res, next));
// Legacy alias for /me — the original frontend calls /auth/profile.
router.get('/profile', authMiddleware, (req, res, next) => authController.getProfile(req, res, next));
router.post('/change-password', authMiddleware, (req, res, next) => authController.changePassword(req, res, next));
router.get('/sessions', authMiddleware, (req, res, next) => authController.listSessions(req, res, next));
router.delete('/sessions/:id', authMiddleware, (req, res, next) => authController.revokeSession(req, res, next));

export default router;
