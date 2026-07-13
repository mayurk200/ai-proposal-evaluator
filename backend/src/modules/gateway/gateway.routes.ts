import { Router, Response, NextFunction } from 'express';
import { AuthRequest, authMiddleware, requireRole } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
import {
  callPython,
  callPythonJson,
  postPythonFiles,
  assertPythonAvailable,
  TIMEOUTS,
  ProxyActor,
} from '../../utils/pythonProxy';
import { AppError } from '../../middleware/errorHandler';

const router = Router();

// Nothing past this point is reachable without a token.
router.use(authMiddleware);

const actorOf = (req: AuthRequest): ProxyActor => ({
  userId: req.userId,
  userRole: req.userRole,
});

/**
 * Upload one or more documents.
 *
 * Bytes go straight through to Python, which stores the single canonical
 * original and owns every derived artifact. Previously Node wrote its own copy
 * to MinIO and Python then wrote a second (and a third for /ingest) — three
 * copies of every file, and no agreement on which was authoritative.
 *
 * The response is immediate: Python persists a row and does extraction,
 * metadata and the similarity check in the background. Nothing is marked
 * successful merely because the bytes arrived.
 */
router.post(
  '/proposals/upload',
  upload.array('files', 25),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        throw new AppError('No files uploaded', 400);
      }

      await assertPythonAvailable();

      const result = await postPythonFiles(
        '/api/v1/proposals/ingest',
        files,
        req.body?.batchId ? { batch_id: String(req.body.batchId) } : {},
        { actor: actorOf(req), timeoutMs: TIMEOUTS.write },
      );

      res.status(202).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Stream the original document back to the browser, so an operator reviewing an
 * approved idea can open the source file it was scored from.
 * `?download=1` forces a save rather than an inline view.
 */
router.get(
  '/proposals/:id/file',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const response = await callPython(
        `/api/v1/proposals/${encodeURIComponent(req.params.id as string)}/file`,
        { actor: actorOf(req), timeoutMs: TIMEOUTS.write },
      );

      const disposition = req.query.download ? 'attachment' : 'inline';
      const filename = response.headers.get('x-filename') ?? 'document';

      res.setHeader(
        'Content-Type',
        response.headers.get('content-type') ?? 'application/octet-stream',
      );
      res.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${encodeURIComponent(filename)}"`,
      );

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch (error) {
      next(error);
    }
  },
);

/** Export an evaluation report as PDF. Streams through untouched. */
router.get(
  '/evaluations/:id/export',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const response = await callPython(
        `/api/v1/evaluations/${encodeURIComponent(req.params.id as string)}/export`,
        { actor: actorOf(req), timeoutMs: TIMEOUTS.write },
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${response.headers.get('x-filename') ?? 'evaluation.pdf'}"`,
      );
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Routes that commit an irreversible judgement are ADMIN-only:
 *   - resolving the duplicate gate (evaluate this idea, or skip it as a dupe)
 *   - approving / rejecting an idea
 *   - marking one selected for funding
 * DESK2 may upload, process, retry and read everything, but may not decide.
 */
const ADMIN_ONLY: Array<{ method: string; pattern: RegExp }> = [
  // Resolve the duplicate gate: evaluate this idea, or skip it as a duplicate.
  { method: 'POST', pattern: /^\/proposals\/[^/]+\/review$/ },
  // Approve / reject an idea — writes to the append-only approval ledger.
  { method: 'POST', pattern: /^\/proposals\/[^/]+\/decision$/ },
  // Mark an idea selected for funding.
  { method: 'POST', pattern: /^\/proposals\/[^/]+\/funding$/ },
  // Destroys a proposal and every artifact hanging off it.
  { method: 'DELETE', pattern: /^\/proposals\/[^/]+$/ },
];

const adminGate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const needsAdmin = ADMIN_ONLY.some(
    (rule) => rule.method === req.method && rule.pattern.test(req.path),
  );
  if (needsAdmin) {
    return requireRole('ADMIN')(req, res, next);
  }
  next();
};

/**
 * Generic pass-through for the rest of the domain API.
 *
 * The Python service owns proposals, evaluations, decisions, categories,
 * companies and analytics. Restating each of those endpoints in Node would mean
 * two places to change for every field added, and the gateway has no business
 * knowing the shape of an evaluation report. It forwards method, path, query and
 * body, and stamps the authenticated identity on the way through so Python can
 * attribute a decision without re-implementing JWT.
 */
router.use(adminGate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    const path = `/api/v1${req.path}${query}`;

    const hasBody = req.method !== 'GET' && req.method !== 'DELETE';

    // An evaluation is minutes of work; a list query is milliseconds. Give the
    // evaluation trigger room and keep everything else on a short leash.
    const isEvaluate = /\/(evaluate|retry)$/.test(req.path);
    const timeoutMs = isEvaluate
      ? TIMEOUTS.evaluate
      : hasBody
        ? TIMEOUTS.write
        : TIMEOUTS.read;

    const data = await callPythonJson(path, {
      method: req.method,
      actor: actorOf(req),
      timeoutMs,
      ...(hasBody
        ? {
            body: JSON.stringify(req.body ?? {}),
            headers: { 'Content-Type': 'application/json' },
          }
        : {}),
    });

    res.json({ status: 'success', data });
  } catch (error) {
    next(error);
  }
});

export default router;
