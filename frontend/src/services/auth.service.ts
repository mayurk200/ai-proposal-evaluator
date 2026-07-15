import api from './api';
import type { ApiResponse, AuthResponse, User, AuthSession } from '@/types';

export const authApi = {
  register: async (data: { email: string; password: string; name: string; company?: string; username?: string }) => {
    const res = await api.post<ApiResponse<AuthResponse>>('/auth/register', data);
    return res.data.data;
  },

  login: async (data: { email: string; password: string }) => {
    const res = await api.post<ApiResponse<AuthResponse>>('/auth/login', data);
    return res.data.data;
  },

  getProfile: async () => {
    const res = await api.get<ApiResponse<User>>('/auth/me');
    return res.data.data;
  },

  logout: async () => {
    await api.post('/auth/logout');
  },

  logoutAll: async () => {
    const res = await api.post<ApiResponse<{ revoked: number }>>('/auth/logout-all');
    return res.data.data;
  },

  changePassword: async (data: { currentPassword: string; newPassword: string }) => {
    await api.post('/auth/change-password', data);
  },

  forgotPassword: async (email: string) => {
    const res = await api.post<ApiResponse<{ message: string }>>('/auth/forgot-password', { email });
    return res.data.data;
  },

  resetPassword: async (data: { token: string; password: string }) => {
    const res = await api.post<ApiResponse<{ message: string }>>('/auth/reset-password', data);
    return res.data.data;
  },

  sessions: async () => {
    const res = await api.get<ApiResponse<AuthSession[]>>('/auth/sessions');
    return res.data.data;
  },

  revokeSession: async (id: string) => {
    await api.delete(`/auth/sessions/${id}`);
  },
};
