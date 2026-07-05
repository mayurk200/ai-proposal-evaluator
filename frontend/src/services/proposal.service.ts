import api from './api';
import type { ApiResponse, Proposal, PaginatedResponse, Evaluation, DashboardStats, Comparison, StoredFile } from '@/types';

export const proposalApi = {
  evaluateFile: async (file: File, title?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);

    const res = await api.post<ApiResponse<any>>('/proposals/evaluate-file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data;
  },

  evaluateBatch: async (files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));

    const res = await api.post<ApiResponse<any>>('/proposals/evaluate-batch', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data;
  },

  upload: async (file: File, title?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);

    const res = await api.post<ApiResponse<Proposal>>('/proposals/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data;
  },

  getAll: async (page = 1, limit = 10) => {
    const res = await api.get<ApiResponse<PaginatedResponse<Proposal>>>(`/proposals?page=${page}&limit=${limit}`);
    return res.data.data;
  },

  getById: async (id: string) => {
    const res = await api.get<ApiResponse<Proposal>>(`/proposals/${id}`);
    return res.data.data;
  },

  delete: async (id: string) => {
    const res = await api.delete<ApiResponse<{ message: string }>>(`/proposals/${id}`);
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

  // GET /api/uploads/categories — distinct agri categories with counts.
  listCategories: async () => {
    const res = await api.get<{ success: boolean; categories: CategoryCount[] }>('/uploads/categories');
    return res.data.categories;
  },
};

export const aiApi = {
  evaluate: async (proposalId: string) => {
    const res = await api.post<ApiResponse<Evaluation>>('/ai/evaluate', { proposalId });
    return res.data.data;
  },

  compare: async (proposalIds: string[], title: string) => {
    const res = await api.post<ApiResponse<Comparison>>('/ai/compare', { proposalIds, title });
    return res.data.data;
  },

  getDashboard: async () => {
    const res = await api.get<ApiResponse<DashboardStats>>('/ai/dashboard');
    return res.data.data;
  },
};

export const comparisonApi = {
  getAll: async () => {
    const res = await api.get<ApiResponse<Comparison[]>>('/comparisons');
    return res.data.data;
  },

  getById: async (id: string) => {
    const res = await api.get<ApiResponse<Comparison>>(`/comparisons/${id}`);
    return res.data.data;
  },
};
