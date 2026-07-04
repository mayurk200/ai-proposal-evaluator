/**
 * Shared mapper that converts a Python-service `finalScore` object into the
 * frontend-expected evaluation shape. Previously this mapping was duplicated
 * across proposal.controller.ts (instant + fallback paths) and ai.service.ts.
 */

const EMPTY_SWOT = { strengths: [], weaknesses: [], opportunities: [], threats: [] };

/**
 * Canonical set of score/summary fields derived from a Python `finalScore`.
 * Used as the common core for both instant and stored evaluation responses.
 */
export function buildScoreFields(finalScore: any) {
  return {
    overallScore: finalScore.overall_score || 0,
    problemRelevanceScore: finalScore.problem_relevance_score || 0,
    solutionReadinessScore: finalScore.solution_readiness_score || 0,
    pilotDesignScore: finalScore.pilot_design_score || 0,
    farmerAdoptionScore: finalScore.farmer_adoption_score || 0,
    scaleUpScore: finalScore.scaleup_score || 0,
    teamCapacityScore: finalScore.team_capacity_score || 0,
    complianceScore: finalScore.compliance_score || 0,
    innovationScore: finalScore.innovation_score || 0,
    marketScore: finalScore.market_score || 0,
    financialScore: finalScore.financial_score || 0,
    sustainabilityScore: finalScore.sustainability_score || 0,
    scalabilityScore: finalScore.scalability_score || 0,
    agricultureScore: finalScore.agriculture_score || 0,
    riskScore: finalScore.risk_score || 0,
    recommendation: finalScore.recommendation || 'Under Review',
    summary: finalScore.summary || '',
    strengths: finalScore.strengths || [],
    weaknesses: finalScore.weaknesses || [],
    swotAnalysis: finalScore.swot_analysis || { ...EMPTY_SWOT },
  };
}

/**
 * Build the response returned by the instant/fallback evaluate endpoints.
 * `documentMetadata` is only included when provided (Python path has it,
 * the Node.js fallback path does not).
 */
export function buildEvaluationResponse(params: {
  finalScore: any;
  title: string;
  fileName: string;
  fileSize: number;
  agentResults?: any;
  documentMetadata?: any;
}) {
  const scores = buildScoreFields(params.finalScore);

  const response: Record<string, any> = {
    title: params.title,
    fileName: params.fileName,
    fileSize: params.fileSize,
    overallScore: scores.overallScore,
    innovationScore: scores.innovationScore,
    marketScore: scores.marketScore,
    financialScore: scores.financialScore,
    sustainabilityScore: scores.sustainabilityScore,
    scalabilityScore: scores.scalabilityScore,
    agricultureScore: scores.agricultureScore,
    riskScore: scores.riskScore,
    recommendation: scores.recommendation,
    summary: scores.summary,
    strengths: scores.strengths,
    weaknesses: scores.weaknesses,
    swotAnalysis: scores.swotAnalysis,
    agentResults: params.agentResults,
  };

  if (params.documentMetadata !== undefined) {
    response.documentMetadata = params.documentMetadata;
  }

  return response;
}

/**
 * Build the richer evaluation record persisted for stored proposals
 * (includes all parameter scores plus raw/parameter/debate metadata).
 */
export function buildStoredEvaluation(params: {
  finalScore: any;
  id: string;
  proposalId: string;
  agentResults?: any;
  documentMetadata?: any;
  timestamp: string;
}) {
  const scores = buildScoreFields(params.finalScore);

  return {
    id: params.id,
    proposalId: params.proposalId,
    ...scores,
    agentResults: params.agentResults,
    rawResponse: params.finalScore,
    parameterBreakdown: params.finalScore.parameter_breakdown || {},
    debateSummary: params.finalScore.debate_summary || null,
    documentMetadata: params.documentMetadata,
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
  };
}
