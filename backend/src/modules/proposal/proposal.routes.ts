import { Router } from 'express';
import { proposalController } from './proposal.controller';
import { optionalAuthMiddleware } from '../../middleware/auth';

const router = Router();

router.get('/', optionalAuthMiddleware, (req, res, next) => proposalController.getAll(req, res, next));
router.get('/:id', optionalAuthMiddleware, (req, res, next) => proposalController.getById(req, res, next));
router.post('/:id/claim', optionalAuthMiddleware, (req, res, next) => proposalController.claimProposal(req, res, next));
router.delete('/:id', optionalAuthMiddleware, (req, res, next) => proposalController.delete(req, res, next));
router.patch('/:id/reject', optionalAuthMiddleware, (req, res, next) => proposalController.reject(req, res, next));

export default router;
