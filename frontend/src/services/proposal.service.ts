import api from './api';
import type { ApiResponse, Proposal, PaginatedResponse, Evaluation, DashboardStats, Comparison } from '@/types';

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
