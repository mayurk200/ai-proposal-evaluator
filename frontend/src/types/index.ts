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
export type ProposalStatus = 'UPLOADED' | 'EXTRACTING' | 'EVALUATING' | 'EVALUATED' | 'FAILED';

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

export interface Evaluation {
  id: string;
  proposalId: string;
  overallScore: number;
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
    createdAt: string;
  }[];
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
