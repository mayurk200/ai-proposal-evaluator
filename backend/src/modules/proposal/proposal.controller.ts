import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { proposalService } from './proposal.service';

export class ProposalController {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await proposalService.findAll(req.userId || null, page, limit);
      res.json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const proposal = await proposalService.findById(req.params.id as string, req.userId || null);
      res.json({ status: 'success', data: proposal });
    } catch (error) {
      next(error);
    }
  }

  async claimProposal(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.userId) {
        res.status(401).json({ status: 'error', message: 'Login required to claim proposals' });
        return;
      }
      const result = await proposalService.claimProposal(req.params.id as string, req.userId);
      res.json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await proposalService.delete(req.params.id as string, req.userId || null);
      res.json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  async reject(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await proposalService.reject(req.params.id as string, req.userId || null);
      res.json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const proposalController = new ProposalController();
