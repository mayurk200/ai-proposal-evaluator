// ===== User Types =====
export interface User {
  id: string;
  username?: string;
  email: string;
  name: string;
  company?: string | null;
  role: 'USER' | 'ADMIN';
  isActive?: boolean;
  emailVerified?: boolean;
  lastLogin?: string | null;
  createdAt: string;
  _count?: { proposals: number };
}

export interface AuthResponse {
  user: User;
  /** Short-lived access token; the refresh token lives in an HttpOnly cookie. */
  token: string;
}

export interface AuthSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

// ===== Proposal Types =====
export type ProposalStatus = 'UPLOADED' | 'EXTRACTING' | 'EVALUATING' | 'EVALUATED' | 'FAILED' | 'REJECTED';

export interface Proposal {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  extractedText?: string;
  status: ProposalStatus;
  userId: string;
  createdAt: string;
  updatedAt: string;
  evaluation?: Evaluation;
  aiLogs?: AiLog[];
}

// ===== Evaluation Types =====
export interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface SubQuestionResult {
  question_id: string;
  question: string;
  score: number; // 0-10
  evidence: string;
  justification: string;
  mapped_fields_found: string[];
}

export interface ParameterBreakdown {
  parameter_name: string;
  parameter_score: number; // 0-100
  sub_questions: SubQuestionResult[];
  key_findings: string[];
  red_flags: string[];
  recommendations: string[];
}

export interface DebateSummary {
  conflicts: Array<{
    conflict_id: string;
    description: string;
    agent_a: string;
    agent_b: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  debates: Array<{
    conflict_id: string;
    topic: string;
    resolution: string;
    position_a?: { agent: string; argument: string; evidence?: string };
    position_b?: { agent: string; argument: string; evidence?: string };
    score_adjustments: Array<{
      parameter: string;
      sub_question_id: string;
      current_score: number;
      adjusted_score: number;
      adjustment: number;
      reason: string;
    }>;
  }>;
  adjusted_scores: Record<string, number>;
  high_ambiguity_areas: string[];
  confidence: number;
}

export interface Evaluation {
  id: string;
  proposalId: string;
  overallScore: number;

  // New AIAIC parameter-aligned scores
  problemRelevanceScore?: number;
  solutionReadinessScore?: number;
  pilotDesignScore?: number;
  farmerAdoptionScore?: number;
  scaleUpScore?: number;
  teamCapacityScore?: number;
  complianceScore?: number;

  // Legacy scores (backward compatibility)
  innovationScore: number;
  marketScore: number;
  financialScore: number;
  sustainabilityScore: number;
  scalabilityScore: number;
  agricultureScore: number;
  riskScore: number;

  recommendation: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  swotAnalysis: SwotAnalysis;
  agentResults: Record<string, unknown>;
  rawResponse?: unknown;

  // New structured breakdown
  parameterBreakdown?: Record<string, ParameterBreakdown>;
  debateSummary?: DebateSummary;

  createdAt: string;
  updatedAt: string;
}

// ===== AI Log Types =====
export interface AiLog {
  id: string;
  proposalId: string;
  agentName: string;
  prompt: string;
  response: string;
  tokens?: number;
  duration?: number;
  status: string;
  createdAt: string;
}

// ===== AIAIC Parameter Names =====
export const AIAIC_PARAMETERS = [
  { key: 'problemRelevanceScore', label: 'Problem Relevance', weight: 0.15 },
  { key: 'solutionReadinessScore', label: 'Solution Readiness', weight: 0.20 },
  { key: 'pilotDesignScore', label: 'Pilot Design', weight: 0.20 },
  { key: 'farmerAdoptionScore', label: 'Farmer Adoption', weight: 0.15 },
  { key: 'scaleUpScore', label: 'Scale-up Potential', weight: 0.15 },
  { key: 'teamCapacityScore', label: 'Team Capacity', weight: 0.10 },
  { key: 'complianceScore', label: 'Compliance', weight: 0.05 },
] as const;

// ===== Storage / Upload Types =====
export interface StoredFile {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  url: string;
}

// ===== API Types =====
export interface ApiResponse<T> {
  status: 'success' | 'error';
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  proposals: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
