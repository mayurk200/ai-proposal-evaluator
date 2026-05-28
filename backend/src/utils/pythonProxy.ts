/**
 * Proxy utility for communicating with the Python AI Processing Service.
 * Handles file forwarding, response mapping, and error handling.
 */

import { env } from '../config/env';

interface PythonEvaluationResponse {
  status: string;
  document_metadata: {
    filename: string;
    format: string;
    file_size_bytes: number;
    total_pages: number;
    total_words: number;
    total_chunks: number;
    total_images: number;
    total_tables: number;
    has_scanned_content: boolean;
    detected_sections: string[];
    processing_time_seconds: number;
  };
  evaluation: {
    overall_score: number;
    problem_relevance_score: number;
    technical_soundness_score: number;
    pilot_design_score: number;
    team_capability_score: number;
    market_potential_score: number;
    financial_sustainability_score: number;
    strategic_impact_score: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    swot_analysis: {
      strengths: string[];
      weaknesses: string[];
      opportunities: string[];
      threats: string[];
    };
    key_points: string[];
    invalid_claims: string[];
    investment_readiness: string;
    key_action_items: string[];
    risk_level: string;
  };
  agent_results: Record<string, any>;
  processing_time_seconds: number;
}

/**
 * Send a file to the Python service for full AI evaluation.
 */
export async function evaluateWithPythonService(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  runOcr: boolean = true,
): Promise<PythonEvaluationResponse> {
  const baseUrl = env.PYTHON_SERVICE_URL;
  const url = `${baseUrl}/api/v1/evaluate`;

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append('file', blob, filename);
  formData.append('run_ocr', String(runOcr));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000); // 5 min timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Python service error (${response.status}): ${errorBody}`);
    }

    return await response.json();
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Python service evaluation timed out after 5 minutes');
    }
    throw new Error(`Python service communication failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Map the Python service evaluation response to the format expected
 * by the existing Node.js backend and frontend.
 */
export function mapPythonResponseToLegacy(response: PythonEvaluationResponse) {
  const evaluation = response.evaluation;

  return {
    finalScore: {
      overall_score: evaluation.overall_score,
      problem_relevance_score: evaluation.problem_relevance_score,
      technical_soundness_score: evaluation.technical_soundness_score,
      pilot_design_score: evaluation.pilot_design_score,
      team_capability_score: evaluation.team_capability_score,
      market_potential_score: evaluation.market_potential_score,
      financial_sustainability_score: evaluation.financial_sustainability_score,
      strategic_impact_score: evaluation.strategic_impact_score,
      recommendation: evaluation.recommendation,
      summary: evaluation.summary,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      swot_analysis: evaluation.swot_analysis,
      investment_readiness: evaluation.investment_readiness,
      key_action_items: evaluation.key_action_items,
    },
    agentResults: response.agent_results,
  };
}

/**
 * Check if the Python service is available.
 */
export async function checkPythonServiceHealth(): Promise<boolean> {
  try {
    const baseUrl = env.PYTHON_SERVICE_URL;
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
