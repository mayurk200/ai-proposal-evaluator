import { Router } from 'express';
import { proposalController } from './proposal.controller';
import { optionalAuthMiddleware } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
import multer from 'multer';

const router = Router();

// Memory-based upload for instant evaluation (no disk storage)
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10485760 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, DOC, and TXT files are allowed.'));
    }
  },
});

// Instant evaluate: upload file → extract text in memory → AI evaluation → return results
router.post('/evaluate-file', optionalAuthMiddleware, memUpload.single('file'), (req, res, next) => proposalController.evaluateFile(req, res, next));

// Legacy routes (kept for backward compatibility)
router.post('/upload', optionalAuthMiddleware, upload.single('file'), (req, res, next) => proposalController.upload(req, res, next));
router.get('/', optionalAuthMiddleware, (req, res, next) => proposalController.getAll(req, res, next));
router.get('/:id', optionalAuthMiddleware, (req, res, next) => proposalController.getById(req, res, next));
router.post('/:id/claim', optionalAuthMiddleware, (req, res, next) => proposalController.claimProposal(req, res, next));
router.delete('/:id', optionalAuthMiddleware, (req, res, next) => proposalController.delete(req, res, next));
router.patch('/:id/reject', optionalAuthMiddleware, (req, res, next) => proposalController.reject(req, res, next));

export default router;
