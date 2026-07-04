import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { proposalService } from './proposal.service';
import { extractTextFromBuffer } from '../../utils/textExtractor';
import { aiOrchestrator } from '../ai/orchestrator';
import {
  evaluateBatchWithPythonService,
  evaluateWithPythonService,
  mapPythonResponseToLegacy,
  checkPythonServiceHealth,
} from '../../utils/pythonProxy';
import { buildEvaluationResponse } from '../../utils/responseMapper';

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

          const evaluation = buildEvaluationResponse({
            finalScore: mapped.finalScore,
            title,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            agentResults: mapped.agentResults,
            documentMetadata: pythonResponse.document_metadata,
          });

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

      const evaluation = buildEvaluationResponse({
        finalScore: result.finalScore,
        title,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        agentResults: result.agentResults,
      });

      res.json({ status: 'success', data: evaluation });
    } catch (error: any) {
      console.error('Instant evaluation failed:', error);
      next(error);
    }
  }

  /**
   * Batch evaluate: files -> Python service batch pipeline.
   */
  async evaluateBatch(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const files = req.files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        res.status(400).json({ status: 'error', message: 'No files uploaded' });
        return;
      }

      if (files.length < 2) {
        res.status(400).json({ status: 'error', message: 'Use single-file evaluation for one document' });
        return;
      }

      const pythonAvailable = await checkPythonServiceHealth();
      if (!pythonAvailable) {
        res.status(503).json({
          status: 'error',
          message: 'Batch evaluation requires the Python service to be available',
        });
        return;
      }

      console.log(`[EvaluateBatch] Using Python service for ${files.length} files`);
      const batchResponse = await evaluateBatchWithPythonService(files);

      res.json({
        status: 'success',
        data: {
          batchId: batchResponse.batch_id,
          totalFiles: batchResponse.total_files,
          completed: batchResponse.completed,
          failed: batchResponse.failed,
          results: batchResponse.results.map((result) => ({
            evaluationId: result.evaluation_id,
            filename: result.filename,
            status: result.status,
            overallScore: result.overall_score,
            recommendation: result.recommendation,
            fileUrl: result.file_url,
            processingTimeSeconds: result.processing_time_seconds,
            error: result.error,
          })),
        },
      });
    } catch (error: any) {
      console.error('Batch evaluation failed:', error);
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

  /**
   * PHASE 2 — Trigger extraction + AI JSON generation for an uploaded proposal.
   * Pass ?force=true (or {"force": true} in the body) to re-run extraction.
   */
  async extract(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const force = req.query.force === 'true' || req.body?.force === true;
      const result = await proposalService.extract(
        req.params.id as string,
        req.userId || null,
        force
      );
      res.json({ status: 'success', data: result });
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
