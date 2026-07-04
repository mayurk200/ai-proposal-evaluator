import { Router } from 'express';
import { proposalController } from './proposal.controller';
import { optionalAuthMiddleware } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
import multer from 'multer';
import {
  ALLOWED_MIME_TYPES,
  INSTANT_EVALUATE_MAX_SIZE,
  INVALID_FILE_TYPE_MESSAGE,
} from '../../config/constants';
import { evaluateLimiter } from '../../middleware/rateLimit';

const router = Router();

// Memory-based upload for instant evaluation (no disk storage)
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: INSTANT_EVALUATE_MAX_SIZE },
  fileFilter: (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(INVALID_FILE_TYPE_MESSAGE));
    }
  },
});

// Instant evaluate: upload file → extract text in memory → AI evaluation → return results
router.post('/evaluate-file', evaluateLimiter, optionalAuthMiddleware, memUpload.single('file'), (req, res, next) => proposalController.evaluateFile(req, res, next));
router.post('/evaluate-batch', evaluateLimiter, optionalAuthMiddleware, memUpload.array('files', 20), (req, res, next) => proposalController.evaluateBatch(req, res, next));

// Phased pipeline
// Phase 1: upload file → storage (S3) + DB record (no extraction)
router.post('/upload', optionalAuthMiddleware, upload.single('file'), (req, res, next) => proposalController.upload(req, res, next));
// Phase 2: extract text → AI structured JSON → extracted file + JSON stored in storage + DB
router.post('/:id/extract', optionalAuthMiddleware, (req, res, next) => proposalController.extract(req, res, next));
router.get('/', optionalAuthMiddleware, (req, res, next) => proposalController.getAll(req, res, next));
router.get('/:id', optionalAuthMiddleware, (req, res, next) => proposalController.getById(req, res, next));
router.post('/:id/claim', optionalAuthMiddleware, (req, res, next) => proposalController.claimProposal(req, res, next));
router.delete('/:id', optionalAuthMiddleware, (req, res, next) => proposalController.delete(req, res, next));
router.patch('/:id/reject', optionalAuthMiddleware, (req, res, next) => proposalController.reject(req, res, next));

export default router;
