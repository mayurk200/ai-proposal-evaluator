import { Router, Request, Response } from 'express';
import { listEvaluationReports, compareEvaluationReports } from '../../utils/pythonProxy';

/**
 * Evaluation reports — thin proxy over the Python service's stored
 * full-evaluation results, used by the Compare page.
 *
 * GET  /api/reports            List evaluation reports (?page, ?limit, ?status).
 * POST /api/reports/compare    Body { reportIds: string[] } (2-5) — parameter-level
 *                              comparison across the selected reports.
 */
const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const data = await listEvaluationReports({
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      status: (req.query.status as string) || undefined,
    });
    res.status(200).json({ success: true, ...data });
  } catch (err: any) {
    res.status(503).json({
      success: false,
      error: `Could not fetch evaluation reports: ${err.message}`,
    });
  }
});

router.post('/compare', async (req: Request, res: Response) => {
  try {
    const ids = (req.body?.reportIds as string[] | undefined) ?? [];
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 5) {
      return res.status(400).json({
        success: false,
        error: 'Provide between 2 and 5 report ids in "reportIds".',
      });
    }

    const data = await compareEvaluationReports(ids);
    return res.status(200).json({ success: true, ...data });
  } catch (err: any) {
    if (/\(404\)/.test(err.message)) {
      return res.status(404).json({ success: false, error: 'One or more reports were not found.' });
    }
    return res.status(503).json({
      success: false,
      error: `Could not compare reports: ${err.message}`,
    });
  }
});

export default router;
