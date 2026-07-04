/**
 * Proxy utility for communicating with the Python AI Processing Service.
 * Handles file forwarding, response mapping, and error handling.
 */

import { env } from '../config/env';

/** Retry configuration for transient Python-service failures. */
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Transient HTTP statuses worth retrying: rate limiting and gateway/availability
 * errors. A plain 500 is treated as a hard application error (the evaluate
 * pipeline failed deterministically) and is NOT retried.
 */
function isTransientStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Perform a fetch with retry + exponential backoff for transient failures.
 * Retries on network errors and transient statuses (429/502/503/504); does NOT
 * retry on aborts (timeouts), 4xx client errors, or 500s, which won't succeed
 * on a retry.
 *
 * `makeRequest` is a factory so each attempt gets a fresh AbortController/timeout.
 */
async function fetchWithRetry(
  makeRequest: () => { promise: Promise<Response>; cleanup: () => void },
  label: string,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const { promise, cleanup } = makeRequest();

    let response: Response;
    try {
      response = await promise;
    } catch (error: any) {
      cleanup();
      if (error?.name === 'AbortError') {
        throw error; // timeout — surfaced by the caller, not retried
      }
      // Network-level error: transient, retry.
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await backoff(attempt, label, lastError);
        continue;
      }
      break;
    }

    if (response.ok) {
      cleanup();
      return response;
    }

    const errorBody = await response.text();
    cleanup();
    const httpError = new Error(`${label} error (${response.status}): ${errorBody}`);

    // Non-transient HTTP error (4xx, 500): fail fast.
    if (!isTransientStatus(response.status)) {
      throw httpError;
    }

    lastError = httpError;
    if (attempt < MAX_RETRY_ATTEMPTS) {
      await backoff(attempt, label, lastError);
      continue;
    }
    break;
  }

  throw lastError ?? new Error(`${label} failed after ${MAX_RETRY_ATTEMPTS} attempts`);
}

/** Wait with exponential backoff before the next retry attempt. */
async function backoff(attempt: number, label: string, error: Error): Promise<void> {
  const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  console.warn(`[pythonProxy] ${label} attempt ${attempt} failed (${error.message}); retrying in ${delay}ms`);
  await sleep(delay);
}

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

  try {
    const response = await fetchWithRetry(() => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300_000); // 5 min timeout
      return {
        promise: fetch(url, { method: 'POST', body: formData, signal: controller.signal }),
        cleanup: () => clearTimeout(timeout),
      };
    }, 'Python service');

    return await response.json() as PythonEvaluationResponse;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Python service evaluation timed out after 5 minutes');
    }
    throw new Error(`Python service communication failed: ${error.message}`);
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
