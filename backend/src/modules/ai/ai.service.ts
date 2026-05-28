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

          // Save evaluation to Firestore
          const evalId = uuidv4();
          const evaluation = {
            id: evalId,
            proposalId,
            overallScore: mapped.finalScore.overall_score || 0,
            problemRelevanceScore: mapped.finalScore.problem_relevance_score || 0,
            technicalSoundnessScore: mapped.finalScore.technical_soundness_score || 0,
            pilotDesignScore: mapped.finalScore.pilot_design_score || 0,
            teamCapabilityScore: mapped.finalScore.team_capability_score || 0,
            marketPotentialScore: mapped.finalScore.market_potential_score || 0,
            financialSustainabilityScore: mapped.finalScore.financial_sustainability_score || 0,
            strategicImpactScore: mapped.finalScore.strategic_impact_score || 0,
            recommendation: mapped.finalScore.recommendation || 'Under Review',
            summary: mapped.finalScore.summary || '',
            strengths: mapped.finalScore.strengths || [],
            weaknesses: mapped.finalScore.weaknesses || [],
            swotAnalysis: mapped.finalScore.swot_analysis || {
              strengths: [], weaknesses: [], opportunities: [], threats: [],
            },
            agentResults: mapped.agentResults,
            rawResponse: mapped.finalScore,
            documentMetadata: pythonResponse.document_metadata,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

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

      // Truncate to avoid Groq TPM limits in the fallback pipeline
      const MAX_CHARS = 10000; // ~2500 tokens
      const truncatedText = text.length > MAX_CHARS 
        ? text.substring(0, MAX_CHARS) + '\n...[Text truncated to fit AI limits]'
        : text;

      // Run AI orchestration
      const result = await aiOrchestrator.evaluate(proposalId, truncatedText);

      // Save evaluation to Firestore
      const evalId = uuidv4();
      const evaluation = {
        id: evalId,
        proposalId,
        overallScore: result.finalScore.overall_score || 0,
        problemRelevanceScore: result.finalScore.problem_relevance_score || 0,
        technicalSoundnessScore: result.finalScore.technical_soundness_score || 0,
        pilotDesignScore: result.finalScore.pilot_design_score || 0,
        teamCapabilityScore: result.finalScore.team_capability_score || 0,
        marketPotentialScore: result.finalScore.market_potential_score || 0,
        financialSustainabilityScore: result.finalScore.financial_sustainability_score || 0,
        strategicImpactScore: result.finalScore.strategic_impact_score || 0,
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
      maxTokens: 4096,
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

  async getDashboardStats(userId: string | null) {
    // Total proposals
    let totalQuery: any = collections.proposals;
    if (userId) {
      totalQuery = totalQuery.where('userId', '==', userId);
    }
    const totalSnap = await totalQuery.count().get();
    const totalProposals = totalSnap.data().count;

    // Evaluated
    let evalQuery: any = collections.proposals;
    if (userId) {
      evalQuery = evalQuery.where('userId', '==', userId);
    }
    const evalSnap = await evalQuery
      .where('status', '==', 'EVALUATED')
      .count()
      .get();
    const evaluatedProposals = evalSnap.data().count;

    // Recent proposals
    let recentQuery: any = collections.proposals;
    if (userId) {
      recentQuery = recentQuery.where('userId', '==', userId);
    }
    const recentSnap = await recentQuery
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    const recentProposals = await Promise.all(
      recentSnap.docs.map(async (doc: any) => {
        const p = doc.data();
        const evSnap = await collections.evaluations
          .where('proposalId', '==', p.id)
          .limit(1)
          .get();
        return {
          ...p,
          evaluation: evSnap.empty ? null : {
            id: evSnap.docs[0].data().id,
            overallScore: evSnap.docs[0].data().overallScore,
            recommendation: evSnap.docs[0].data().recommendation,
            summary: evSnap.docs[0].data().summary,
          },
        };
      })
    );

    // Get all evaluations for proposals
    let proposalQuery: any = collections.proposals;
    if (userId) {
      proposalQuery = proposalQuery.where('userId', '==', userId);
    }
    const proposalSnap = await proposalQuery.get();
    const proposalIds = proposalSnap.docs.map((d: any) => d.data().id);

    let evaluations: any[] = [];
    let topProposals: any[] = [];

    if (proposalIds.length > 0) {
      // Firestore 'in' supports max 30 items
      const chunks = [];
      for (let i = 0; i < proposalIds.length; i += 30) {
        chunks.push(proposalIds.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        const evalsSnap = await collections.evaluations
          .where('proposalId', 'in', chunk)
          .get();
        evaluations.push(...evalsSnap.docs.map((d: any) => d.data()));
      }

      // Top proposals
      topProposals = evaluations
        .sort((a, b) => b.overallScore - a.overallScore)
        .slice(0, 5)
        .map((ev) => {
          const prop = proposalSnap.docs.find((d: any) => d.data().id === ev.proposalId)?.data();
          return { ...ev, proposal: prop };
        });
    }

    // Avg score
    const avgScore = evaluations.length > 0
      ? Math.round(evaluations.reduce((sum, e) => sum + e.overallScore, 0) / evaluations.length)
      : 0;

    // Category stats
    const categoryMap: Record<string, { count: number; totalScore: number }> = {};
    evaluations.forEach((e) => {
      const rec = e.recommendation || 'Unknown';
      if (!categoryMap[rec]) categoryMap[rec] = { count: 0, totalScore: 0 };
      categoryMap[rec].count++;
      categoryMap[rec].totalScore += e.overallScore;
    });
    const categoryStats = Object.entries(categoryMap).map(([rec, data]) => ({
      recommendation: rec,
      _count: data.count,
      _avg: { overallScore: Math.round(data.totalScore / data.count) },
    }));

    // Score history
    const scoreHistory = evaluations
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((e) => ({
        overallScore: e.overallScore,
        problemRelevanceScore: e.problemRelevanceScore || 0,
        technicalSoundnessScore: e.technicalSoundnessScore || 0,
        pilotDesignScore: e.pilotDesignScore || 0,
        teamCapabilityScore: e.teamCapabilityScore || 0,
        marketPotentialScore: e.marketPotentialScore || 0,
        financialSustainabilityScore: e.financialSustainabilityScore || 0,
        strategicImpactScore: e.strategicImpactScore || 0,
        createdAt: e.createdAt,
      }));

    return {
      totalProposals,
      evaluatedProposals,
      pendingProposals: totalProposals - evaluatedProposals,
      averageScore: avgScore,
      recentProposals,
      topProposals,
      categoryStats,
      scoreHistory,
    };
  }
}

export const aiService = new AIService();
