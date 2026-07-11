import api from './api';
import type { ApiResponse, Proposal, StoredFile } from '@/types';

export const proposalApi = {
  getById: async (id: string) => {
    const res = await api.get<ApiResponse<Proposal>>(`/proposals/${id}`);
    return res.data.data;
  },

  claim: async (id: string) => {
    const res = await api.post<ApiResponse<{ message: string }>>(`/proposals/${id}/claim`);
    return res.data.data;
  },

  reject: async (id: string) => {
    const res = await api.patch<ApiResponse<{ message: string }>>(`/proposals/${id}/reject`);
    return res.data.data;
  },
};

// ===== Phase 1: raw file storage (MinIO) =====
// Files uploaded here go straight to object storage. No extraction or AI runs —
// nothing happens to a file until the user explicitly chooses to act on it.
export interface StorageUploadResult {
  originalName: string;
  key: string;
  size: number;
  contentType: string;
  url: string;
}

// ===== Phase 2: processing (extract + agri categorization, no scoring) =====
export interface CategorizationDetail {
  title?: string;
  summary?: string;
  problem_statement?: string;
  proposed_solution?: string;
  technologies?: string[];
  target_beneficiaries?: string[];
  geography?: string;
  stage?: string;
  categories?: string[];
  keywords?: string[];
  agri_relevance?: number;
  rank?: number;
  confidence?: number;
  flags?: {
    agri_relevant?: boolean;
    needs_review?: boolean;
    insufficient_text?: boolean;
    out_of_scope?: boolean;
  };
}

export interface ProcessedProposal {
  id: string;
  filename?: string;
  status?: string;
  rank?: number;
  agri_relevant?: boolean;
  categories?: string[];
  categorization?: CategorizationDetail | null;
  source_key?: string | null;
  created_at?: string;
  categorized_at?: string | null;
}

export interface ProcessedProposalList {
  proposals: ProcessedProposal[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

// Full stored record for one proposal ("More info"): everything the agent used
// (the extracted text) plus file metadata, storage links and extraction stats.
export interface ProcessedProposalDetail extends ProcessedProposal {
  document_format?: string;
  file_content_type?: string;
  file_size_bytes?: number;
  file_hash?: string | null;
  original_key?: string | null;
  original_url?: string | null;
  extracted_key?: string | null;
  extracted_url?: string | null;
  manifest_key?: string | null;
  manifest_url?: string | null;
  source_url?: string | null;
  extracted_text?: string | null;
  char_count?: number;
  total_pages?: number;
  total_words?: number;
  total_images?: number;
  total_tables?: number;
  has_scanned_content?: boolean;
  detected_sections?: string[];
  error_message?: string | null;
  extracted_at?: string | null;
  updated_at?: string | null;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export const uploadApi = {
  // POST /api/uploads — send one or more files to storage (multipart field "files").
  upload: async (files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));

    const res = await api.post<{ success: boolean; count: number; files: StorageUploadResult[] }>(
      '/uploads',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return res.data;
  },

  // GET /api/uploads — list everything currently in storage (for the "All Files" tab).
  list: async () => {
    const res = await api.get<{ success: boolean; count: number; files: StoredFile[]; note?: string }>('/uploads');
    return res.data;
  },

  // POST /api/uploads/process — send selected stored files for processing.
  sendForProcessing: async (files: { key: string; name?: string }[]) => {
    const res = await api.post<{
      success: boolean;
      submitted: number;
      failed: number;
      results: Array<{ key: string; proposalId?: string; status?: string; deduplicated?: boolean; error?: string }>;
    }>('/uploads/process', { files });
    return res.data;
  },

  // GET /api/uploads/processed — list categorized proposals (for the Proposals page).
  listProcessed: async (params: { category?: string; status?: string; page?: number; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.category) search.set('category', params.category);
    if (params.status) search.set('status', params.status);
    if (params.page) search.set('page', String(params.page));
    if (params.limit) search.set('limit', String(params.limit));
    const qs = search.toString() ? `?${search.toString()}` : '';
    const res = await api.get<{ success: boolean } & ProcessedProposalList>(`/uploads/processed${qs}`);
    return res.data;
  },

  // GET /api/uploads/processed/:id — full record for one proposal ("More info").
  getProcessedDetail: async (id: string) => {
    const res = await api.get<{ success: boolean; proposal: ProcessedProposalDetail }>(
      `/uploads/processed/${encodeURIComponent(id)}`
    );
    return res.data.proposal;
  },

  // DELETE /api/uploads/processed/:id — delete a proposal (DB row + stored files).
  deleteProcessed: async (id: string) => {
    const res = await api.delete<{ success: boolean; deleted: string }>(
      `/uploads/processed/${encodeURIComponent(id)}`
    );
    return res.data;
  },

  // GET /api/uploads/categories — distinct agri categories with counts.
  listCategories: async () => {
    const res = await api.get<{ success: boolean; categories: CategoryCount[] }>('/uploads/categories');
    return res.data.categories;
  },

  // POST /api/uploads/processed/:id/evaluate — run the full multi-agent
  // evaluation for a processed proposal (?force=true re-runs an existing one).
  evaluateProcessed: async (id: string, force = false) => {
    const res = await api.post<{
      success: boolean;
      proposalId: string;
      evaluationId: string | null;
      overallScore: number | null;
      recommendation: string | null;
    }>(`/uploads/processed/${encodeURIComponent(id)}/evaluate${force ? '?force=true' : ''}`);
    return res.data;
  },
};

// ===== Evaluation reports (full multi-agent results, used by Compare) =====

export interface EvaluationReportSummary {
  id: string;
  filename: string;
  file_storage_url?: string | null;
  file_size_bytes?: number;
  overall_score: number;
  recommendation: string;
  status: string;
  proposal_id?: string | null;
  created_at?: string | null;
}

/** The `evaluation` object inside a stored report (Python FinalEvaluation). */
export interface ReportEvaluation {
  overall_score: number;
  problem_relevance_score: number;
  solution_readiness_score: number;
  pilot_design_score: number;
  farmer_adoption_score: number;
  scaleup_score: number;
  team_capacity_score: number;
  compliance_score: number;
  recommendation: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  swot_analysis?: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  investment_readiness?: string;
  risk_level?: string;
}

export interface FullReport extends EvaluationReportSummary {
  evaluation_report?: { evaluation?: ReportEvaluation } | null;
}

export interface ReportComparison {
  total_reports: number;
  overall_scores: Record<string, { filename: string; score: number }>;
  parameter_scores: Record<string, Record<string, { filename: string; score: number }>>;
  recommendations: Record<string, { filename: string; recommendation: string }>;
  ranking: Array<{ rank: number; id: string; filename: string; score: number }>;
}

export const reportsApi = {
  // GET /api/reports — list stored evaluation reports.
  list: async (params: { page?: number; limit?: number; status?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set('page', String(params.page));
    if (params.limit) search.set('limit', String(params.limit));
    if (params.status) search.set('status', params.status);
    const qs = search.toString() ? `?${search.toString()}` : '';
    const res = await api.get<{
      success: boolean;
      evaluations: EvaluationReportSummary[];
      total: number;
    }>(`/reports${qs}`);
    return res.data;
  },

  // POST /api/reports/compare — parameter-level comparison of 2-5 reports.
  compare: async (reportIds: string[]) => {
    const res = await api.post<{
      success: boolean;
      reports: FullReport[];
      comparison: ReportComparison;
    }>('/reports/compare', { reportIds });
    return res.data;
  },
};
