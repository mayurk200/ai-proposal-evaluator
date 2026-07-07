import { Router } from 'express';
import { aiController } from './ai.controller';
import { optionalAuthMiddleware } from '../../middleware/auth';

const router = Router();

router.post('/evaluate', optionalAuthMiddleware, (req, res, next) => aiController.evaluate(req, res, next));
router.post('/compare', optionalAuthMiddleware, (req, res, next) => aiController.compare(req, res, next));

export default router;
