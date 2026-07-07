import { Router } from 'express';
import { uploadController } from './upload.controller';
import { upload } from '../../middleware/upload';
import { evaluateLimiter } from '../../middleware/rateLimit';

const router = Router();

/**
 * Phase 1 endpoints.
 *
 * POST /api/uploads  (multipart/form-data, field "files" — one or many)
 *   Stores every uploaded file in the MinIO bucket and returns their keys/URLs.
 *
 * GET  /api/uploads
 *   Lists everything currently stored (name, size, uploaded time, URL) so the
 *   frontend "All Files" tab can show the user what is in storage.
 */
router.post('/', upload.array('files', 20), (req, res, next) =>
  uploadController.uploadMany(req, res, next)
);

router.get('/', (req, res, next) => uploadController.listAll(req, res, next));

/**
 * Phase 2 endpoints.
 *
 * POST /api/uploads/process   Body { files: { key, name }[] } — send stored
 *   files for extraction + agri categorization (async on the Python service).
 * GET  /api/uploads/processed  List categorized proposals (?category, ?status).
 * GET  /api/uploads/processed/:id  Full record for one proposal ("More info").
 * DELETE /api/uploads/processed/:id  Delete a proposal (DB row + stored files).
 * GET  /api/uploads/categories Distinct agri categories with counts.
 */
router.post('/process', (req, res, next) => uploadController.process(req, res, next));
// Full multi-agent evaluation for one processed proposal (?force=true re-runs).
router.post('/processed/:id/evaluate', evaluateLimiter, (req, res, next) =>
  uploadController.evaluateProcessed(req, res, next)
);
router.get('/processed', (req, res, next) => uploadController.listProcessed(req, res, next));
router.get('/processed/:id', (req, res, next) => uploadController.getProcessed(req, res, next));
router.delete('/processed/:id', (req, res, next) => uploadController.deleteProcessed(req, res, next));
router.get('/categories', (req, res, next) => uploadController.listCategories(req, res, next));

export default router;
