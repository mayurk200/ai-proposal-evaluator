import { Router } from 'express';
import { settingsController } from './settings.controller';
import { authMiddleware, requireAdmin } from '../../middleware/auth';

const router = Router();

// Any authenticated user may view the schema and current (masked) settings.
router.get('/schema', authMiddleware, (req, res, next) => settingsController.getSchema(req, res, next));
router.get('/', authMiddleware, (req, res, next) => settingsController.getSettings(req, res, next));

// Only admins may change or reset settings.
router.put('/', authMiddleware, requireAdmin, (req, res, next) => settingsController.updateSettings(req, res, next));
router.post('/reset', authMiddleware, requireAdmin, (req, res, next) => settingsController.resetSettings(req, res, next));

export default router;
