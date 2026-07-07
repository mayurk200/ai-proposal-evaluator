import { v4 as uuidv4 } from 'uuid';
import { collections } from '../../config/database';
import { aiOrchestrator } from './orchestrator';
import { extractTextFromFile } from '../../utils/textExtractor';
import { AppError } from '../../middleware/errorHandler';
import { COMPARISON_PROMPT } from './prompts';
import { BaseAgent } from './agents/baseAgent';
import {
  evaluateWithPythonService,
  mapPythonResponseToLegacy,
  checkPythonServiceHealth,
} from '../../utils/pythonProxy';
import { buildStoredEvaluation } from '../../utils/responseMapper';
import fs from 'fs';

export class AIService {
  async evaluateProposal(proposalId: string) {
    const doc = await collections.proposals.doc(proposalId).get();

    if (!doc.exists) {
      throw new AppError('Proposal not found', 404);
    }

    const proposal = doc.data()!;

    // Update status
    await collections.proposals.doc(proposalId).update({ status: 'EXTRACTING' });

    try {
      // Try Python service first (supports OCR, chunking, multi-agent)
      const pythonAvailable = await checkPythonServiceHealth();

      if (pythonAvailable && proposal.filePath && fs.existsSync(proposal.filePath)) {
        try {
          console.log(`[AI] Using Python service for proposal: ${proposalId}`);
          await collections.proposals.doc(proposalId).update({ status: 'EVALUATING' });

          const fileBuffer = fs.readFileSync(proposal.filePath);
          const pythonResponse = await evaluateWithPythonService(
            fileBuffer,
            proposal.fileName || 'document.pdf',
            proposal.fileType || 'application/pdf',
          );

          const mapped = mapPythonResponseToLegacy(pythonResponse);

          // Save evaluation to the document store
          const evalId = uuidv4();
          const evaluation = buildStoredEvaluation({
            finalScore: mapped.finalScore,
            id: evalId,
            proposalId,
            agentResults: mapped.agentResults,
            documentMetadata: pythonResponse.document_metadata,
            timestamp: new Date().toISOString(),
          });

          await collections.evaluations.doc(evalId).set(evaluation);
          await collections.proposals.doc(proposalId).update({ status: 'EVALUATED' });

          return evaluation;
        } catch (pythonError: any) {
          console.warn(`[AI] Python service failed, falling back to Node.js: ${pythonError.message}`);
        }
      }

      // Fallback: Original Node.js pipeline
      // Extract text if not done
      let text = proposal.extractedText;
      if (!text) {
        text = await extractTextFromFile(proposal.filePath, proposal.fileType);
        await collections.proposals.doc(proposalId).update({
          extractedText: text,
          status: 'EVALUATING',
        });
      } else {
        await collections.proposals.doc(proposalId).update({ status: 'EVALUATING' });
      }

      // Run AI orchestration
      const result = await aiOrchestrator.evaluate(proposalId, text);

      // Save evaluation to the document store
      const evalId = uuidv4();
      const evaluation = {
        id: evalId,
        proposalId,
        overallScore: result.finalScore.overall_score || 0,
        problemRelevanceScore: result.finalScore.agriculture_score || 0,
        solutionReadinessScore: result.finalScore.innovation_score || 0,
        pilotDesignScore: result.finalScore.risk_score || 0,
        farmerAdoptionScore: result.finalScore.sustainability_score || 0,
        scaleUpScore: result.finalScore.scalability_score || 0,
        teamCapacityScore: result.finalScore.feasibility_score || 0,
        complianceScore: result.finalScore.compliance_score || 0,
        innovationScore: result.finalScore.innovation_score || 0,
        marketScore: result.finalScore.market_score || 0,
        financialScore: result.finalScore.financial_score || 0,
        sustainabilityScore: result.finalScore.sustainability_score || 0,
        scalabilityScore: result.finalScore.scalability_score || 0,
        agricultureScore: result.finalScore.agriculture_score || 0,
        riskScore: result.finalScore.risk_score || 0,
        recommendation: result.finalScore.recommendation || 'Under Review',
        summary: result.finalScore.summary || '',
        strengths: result.finalScore.strengths || [],
        weaknesses: result.finalScore.weaknesses || [],
        swotAnalysis: result.finalScore.swot_analysis || {
          strengths: [], weaknesses: [], opportunities: [], threats: [],
        },
        agentResults: result.agentResults,
        rawResponse: result.finalScore,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await collections.evaluations.doc(evalId).set(evaluation);

      // Update proposal status
      await collections.proposals.doc(proposalId).update({ status: 'EVALUATED' });

      return evaluation;
    } catch (error: any) {
      await collections.proposals.doc(proposalId).update({ status: 'FAILED' });
      throw new AppError(`Evaluation failed: ${error.message}`, 500);
    }
  }

  async compareProposals(proposalIds: string[], userId: string | null, title: string) {
    // Fetch proposals with evaluations
    const proposals = await Promise.all(
      proposalIds.map(async (id) => {
        const doc = await collections.proposals.doc(id).get();
        if (!doc.exists) return null;
        const proposal = doc.data()!;

        const evalSnap = await collections.evaluations
          .where('proposalId', '==', id)
          .limit(1)
          .get();
        const evaluation = evalSnap.empty ? null : evalSnap.docs[0].data();

        return { ...proposal, evaluation };
      })
    );

    const validProposals = proposals.filter((p) => p && p.evaluation);

    if (validProposals.length < 2) {
      throw new AppError('At least 2 evaluated proposals required for comparison', 400);
    }

    const comparisonData = validProposals.map((p) => ({
      title: p!.title,
      evaluation: p!.evaluation,
    }));

    const comparisonAgent = new BaseAgent({
      name: 'ComparisonAgent',
      temperature: 0.3,
      maxTokens: 1500,
      maxInputChars: 10000,
    });

    const { result } = await comparisonAgent.execute(
      COMPARISON_PROMPT,
      JSON.stringify(comparisonData)
    );

    const compId = uuidv4();
    const comparison = {
      id: compId,
      title,
      summary: result.comparison_summary || '',
      result,
      userId,
      proposalIds,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await collections.comparisons.doc(compId).set(comparison);

    // Return with nested proposal data
    return {
      ...comparison,
      proposals: validProposals.map((p) => ({
        id: uuidv4(),
        proposal: p,
      })),
    };
  }

}

export const aiService = new AIService();
