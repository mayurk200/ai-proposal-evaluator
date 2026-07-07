import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { aiService } from './ai.service';
import { z } from 'zod';

const evaluateSchema = z.object({
  proposalId: z.string().uuid(),
});

const compareSchema = z.object({
  proposalIds: z.array(z.string().uuid()).min(2).max(5),
  title: z.string().min(1),
});

export class AIController {
  async evaluate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { proposalId } = evaluateSchema.parse(req.body);
      const evaluation = await aiService.evaluateProposal(proposalId);
      res.json({ status: 'success', data: evaluation });
    } catch (error) {
      next(error);
    }
  }

  async compare(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { proposalIds, title } = compareSchema.parse(req.body);
      const comparison = await aiService.compareProposals(proposalIds, req.userId || null, title);
      res.json({ status: 'success', data: comparison });
    } catch (error) {
      next(error);
    }
  }
}

export const aiController = new AIController();
