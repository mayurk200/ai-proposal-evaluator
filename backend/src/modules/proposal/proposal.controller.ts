import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { proposalService } from './proposal.service';
import { extractTextFromBuffer } from '../../utils/textExtractor';
import { aiOrchestrator } from '../ai/orchestrator';
import {
  evaluateWithPythonService,
  mapPythonResponseToLegacy,
  checkPythonServiceHealth,
} from '../../utils/pythonProxy';

export class ProposalController {
  /**
   * Instant evaluate: file → Python service (preferred) → fallback to Node.js.
   * No file saved to disk.
   */
  async evaluateFile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({ status: 'error', message: 'No file uploaded' });
        return;
      }

      const title = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');

      // Try Python service first (better processing: OCR, chunking, multi-agent)
      const pythonAvailable = await checkPythonServiceHealth();

      if (pythonAvailable) {
        try {
          console.log(`[Evaluate] Using Python service for: ${req.file.originalname}`);

          const pythonResponse = await evaluateWithPythonService(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype,
          );

          const mapped = mapPythonResponseToLegacy(pythonResponse);

          const evaluation = {
            title,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            overallScore: mapped.finalScore.overall_score || 0,
            problemRelevanceScore: mapped.finalScore.problem_relevance_score || 0,
            technicalSoundnessScore: mapped.finalScore.technical_soundness_score || 0,
            pilotDesignScore: mapped.finalScore.pilot_design_score || 0,
            teamCapabilityScore: mapped.finalScore.team_capability_score || 0,
            marketPotentialScore: mapped.finalScore.market_potential_score || 0,
            financialSustainabilityScore: mapped.finalScore.financial_sustainability_score || 0,
            strategicImpactScore: mapped.finalScore.strategic_impact_score || 0,
            recommendation: mapped.finalScore.recommendation || 'Reject',
            summary: mapped.finalScore.summary || '',
            strengths: mapped.finalScore.strengths || [],
            weaknesses: mapped.finalScore.weaknesses || [],
            swotAnalysis: mapped.finalScore.swot_analysis || {
              strengths: [], weaknesses: [], opportunities: [], threats: [],
            },
            agentResults: mapped.agentResults,
            documentMetadata: pythonResponse.document_metadata,
          };

          res.json({ status: 'success', data: evaluation });
          return;
        } catch (pythonError: any) {
          console.warn(`[Evaluate] Python service failed, falling back to Node.js: ${pythonError.message}`);
        }
      } else {
        console.log(`[Evaluate] Python service unavailable, using Node.js fallback`);
      }

      // Fallback: Original Node.js evaluation pipeline
      const text = await extractTextFromBuffer(req.file.buffer, req.file.mimetype);

      if (!text || text.trim().length < 50) {
        res.status(400).json({
          status: 'error',
          message: 'Could not extract sufficient text from the file. Please ensure the file contains readable text.',
        });
        return;
      }

      const result = await aiOrchestrator.evaluate('instant', text);

      const evaluation = {
        title,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        overallScore: result.finalScore.overall_score || 0,
        problemRelevanceScore: result.finalScore.problem_relevance_score || 0,
        technicalSoundnessScore: result.finalScore.technical_soundness_score || 0,
        pilotDesignScore: result.finalScore.pilot_design_score || 0,
        teamCapabilityScore: result.finalScore.team_capability_score || 0,
        marketPotentialScore: result.finalScore.market_potential_score || 0,
        financialSustainabilityScore: result.finalScore.financial_sustainability_score || 0,
        strategicImpactScore: result.finalScore.strategic_impact_score || 0,
        recommendation: result.finalScore.recommendation || 'Reject',
        summary: result.finalScore.summary || '',
        strengths: result.finalScore.strengths || [],
        weaknesses: result.finalScore.weaknesses || [],
        swotAnalysis: result.finalScore.swot_analysis || {
          strengths: [], weaknesses: [], opportunities: [], threats: [],
        },
        agentResults: result.agentResults,
      };

      res.json({ status: 'success', data: evaluation });
    } catch (error: any) {
      console.error('Instant evaluation failed:', error);
      next(error);
    }
  }

  async upload(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        res.status(400).json({ status: 'error', message: 'No file uploaded' });
        return;
      }

      const proposal = await proposalService.create({
        title: req.body.title || req.file.originalname.replace(/\.[^/.]+$/, ''),
        fileName: req.file.originalname,
        file: req.file,
        userId: req.userId || null,
      });

      res.status(201).json({ status: 'success', data: proposal });
    } catch (error) {
      next(error);
    }
  }

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

