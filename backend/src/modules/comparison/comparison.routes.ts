import { Router } from 'express';
import { optionalAuthMiddleware, AuthRequest } from '../../middleware/auth';
import { Response, NextFunction } from 'express';
import { collections } from '../../config/database';

const router = Router();

router.get('/', optionalAuthMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let query = collections.comparisons.orderBy('createdAt', 'desc');
    if (req.userId) {
      query = collections.comparisons
        .where('userId', '==', req.userId)
        .orderBy('createdAt', 'desc');
    }
    const snapshot = await query.get();

    const comparisons = await Promise.all(
      snapshot.docs.map(async (doc: any) => {
        const comp = doc.data();
        // Fetch proposal data for each comparison
        const proposals = await Promise.all(
          (comp.proposalIds || []).map(async (pid: string) => {
            const pDoc = await collections.proposals.doc(pid).get();
            if (!pDoc.exists) return null;
            const proposal = pDoc.data()!;
            const evalSnap = await collections.evaluations
              .where('proposalId', '==', pid)
              .limit(1)
              .get();
            return {
              proposal: {
                ...proposal,
                evaluation: evalSnap.empty ? null : evalSnap.docs[0].data(),
              },
            };
          })
        );
        return { ...comp, proposals: proposals.filter(Boolean) };
      })
    );

    res.json({ status: 'success', data: comparisons });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', optionalAuthMiddleware, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const doc = await collections.comparisons.doc(req.params.id).get();

    if (!doc.exists) {
      res.status(404).json({ status: 'error', message: 'Comparison not found' });
      return;
    }

    const comp = doc.data()!;

    // If user is logged in, check ownership; if not, allow access
    if (req.userId && comp.userId && comp.userId !== req.userId) {
      res.status(403).json({ status: 'error', message: 'Access denied' });
      return;
    }

    const proposals = await Promise.all(
      (comp.proposalIds || []).map(async (pid: string) => {
        const pDoc = await collections.proposals.doc(pid).get();
        if (!pDoc.exists) return null;
        const proposal = pDoc.data()!;
        const evalSnap = await collections.evaluations
          .where('proposalId', '==', pid)
          .limit(1)
          .get();
        return {
          proposal: {
            ...proposal,
            evaluation: evalSnap.empty ? null : evalSnap.docs[0].data(),
          },
        };
      })
    );

    res.json({ status: 'success', data: { ...comp, proposals: proposals.filter(Boolean) } });
  } catch (error) {
    next(error);
  }
});

export default router;
