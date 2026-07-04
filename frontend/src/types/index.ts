// ===== User Types =====
export interface User {
  id: string;
  email: string;
  name: string;
  company?: string;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  _count?: { proposals: number };
}

export interface AuthResponse {
  user: User;
  token: string;
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
  agentResults: Record<string, any>;
  rawResponse?: any;

  // New structured breakdown
  parameterBreakdown?: Record<string, ParameterBreakdown>;
  debateSummary?: DebateSummary;

  createdAt: string;
  updatedAt: string;
}

// ===== Comparison Types =====
export interface Comparison {
  id: string;
  title: string;
  summary?: string;
  result?: any;
  userId: string;
  createdAt: string;
  proposals: {
    id: string;
    proposal: Proposal;
  }[];
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

// ===== Dashboard Types =====
export interface DashboardStats {
  totalProposals: number;
  evaluatedProposals: number;
  pendingProposals: number;
  averageScore: number;
  recentProposals: Proposal[];
  topProposals: (Evaluation & { proposal: Proposal })[];
  categoryStats: { recommendation: string; _count: number; _avg: { overallScore: number } }[];
  scoreHistory: {
    overallScore: number;
    innovationScore: number;
    marketScore: number;
    financialScore: number;
    sustainabilityScore: number;
    riskScore: number;
    // New parameter scores in history
    problemRelevanceScore?: number;
    solutionReadinessScore?: number;
    pilotDesignScore?: number;
    farmerAdoptionScore?: number;
    scaleUpScore?: number;
    teamCapacityScore?: number;
    complianceScore?: number;
    createdAt: string;
  }[];
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
