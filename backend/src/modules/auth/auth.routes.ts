import { Router } from 'express';
import { authController } from './auth.controller';
import { authMiddleware, requireRole } from '../../middleware/auth';

const router = Router();

// Public: the only unauthenticated endpoint in the system.
router.post('/login', (req, res, next) => authController.login(req, res, next));

router.get('/profile', authMiddleware, (req, res, next) =>
  authController.getProfile(req, res, next),
);

// Account management is an ADMIN capability. `POST /register` is gone.
router.get('/users', authMiddleware, requireRole('ADMIN'), (req, res, next) =>
  authController.listUsers(req, res, next),
);
router.post('/users', authMiddleware, requireRole('ADMIN'), (req, res, next) =>
  authController.createUser(req, res, next),
);

export default router;
