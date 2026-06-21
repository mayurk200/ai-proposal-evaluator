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
    solution_readiness_score: number;
    pilot_design_score: number;
    farmer_adoption_score: number;
    scaleup_score: number;
    team_capacity_score: number;
    compliance_score: number;
    innovation_score: number;
    market_score: number;
    agriculture_score: number;
    financial_score: number;
    scalability_score: number;
    sustainability_score: number;
    risk_score: number;
    technical_score: number;
    feasibility_score: number;
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
    parameter_breakdown?: Record<string, any>;
    debate_summary?: any;
  };
  agent_results: Record<string, any>;
  processing_time_seconds: number;
}

interface PythonBatchEvaluationResponse {
  status: string;
  batch_id: string;
  total_files: number;
  completed: number;
  failed: number;
  results: Array<{
    evaluation_id?: string;
    filename: string;
    status: string;
    overall_score?: number;
    recommendation?: string;
    file_url?: string;
    processing_time_seconds?: number;
    error?: string;
  }>;
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

    return await response.json() as PythonEvaluationResponse;
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
 * Send multiple files to the Python service for sequential batch evaluation.
 */
export async function evaluateBatchWithPythonService(
  files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
): Promise<PythonBatchEvaluationResponse> {
  const baseUrl = env.PYTHON_SERVICE_URL;
  const url = `${baseUrl}/api/v1/evaluate-batch`;

  const formData = new FormData();
  for (const file of files) {
    const blob = new Blob([file.buffer], { type: file.mimetype });
    formData.append('files', blob, file.originalname);
  }

  const timeoutMs = Math.max(300_000, files.length * 300_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Python batch service error (${response.status}): ${errorBody}`);
    }

    return await response.json() as PythonBatchEvaluationResponse;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Python batch evaluation timed out after ${Math.round(timeoutMs / 60000)} minutes`);
    }
    throw new Error(`Python batch service communication failed: ${error.message}`);
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
      solution_readiness_score: evaluation.solution_readiness_score,
      pilot_design_score: evaluation.pilot_design_score,
      farmer_adoption_score: evaluation.farmer_adoption_score,
      scaleup_score: evaluation.scaleup_score,
      team_capacity_score: evaluation.team_capacity_score,
      compliance_score: evaluation.compliance_score,
      innovation_score: evaluation.innovation_score,
      market_score: evaluation.market_score,
      agriculture_score: evaluation.agriculture_score,
      financial_score: evaluation.financial_score,
      scalability_score: evaluation.scalability_score,
      sustainability_score: evaluation.sustainability_score,
      risk_score: evaluation.risk_score,
      recommendation: evaluation.recommendation,
      summary: evaluation.summary,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      swot_analysis: evaluation.swot_analysis,
      investment_readiness: evaluation.investment_readiness,
      key_action_items: evaluation.key_action_items,
      parameter_breakdown: evaluation.parameter_breakdown,
      debate_summary: evaluation.debate_summary,
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
