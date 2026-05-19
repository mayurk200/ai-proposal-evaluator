import api from './api';
import type { ApiResponse, AuthResponse } from '@/types';

export const authApi = {
  register: async (data: { email: string; password: string; name: string; company?: string }) => {
    const res = await api.post<ApiResponse<AuthResponse>>('/auth/register', data);
    return res.data.data;
  },

  login: async (data: { email: string; password: string }) => {
    const res = await api.post<ApiResponse<AuthResponse>>('/auth/login', data);
    return res.data.data;
  },

  getProfile: async () => {
    const res = await api.get<ApiResponse<any>>('/auth/profile');
    return res.data.data;
  },
};
