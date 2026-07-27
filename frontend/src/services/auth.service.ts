import api from './api';
import type { ApiResponse, AuthResponse, User } from '@/types';

export const authApi = {
  // `register` is gone — accounts are seeded (admin, desk2) and only an ADMIN
  // may create more, via POST /auth/users.
  login: async (data: { email: string; password: string }) => {
    const res = await api.post<ApiResponse<AuthResponse>>('/auth/login', data);
    return res.data.data;
  },

  getProfile: async () => {
    const res = await api.get<ApiResponse<User>>('/auth/profile');
    return res.data.data;
  },

  listUsers: async () => {
    const res = await api.get<ApiResponse<User[]>>('/auth/users');
    return res.data.data;
  },
};
