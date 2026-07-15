import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/authStore';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Send/receive the HttpOnly refresh-token cookie on the /api/auth routes.
  withCredentials: true,
});

// Request interceptor - attach JWT
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Endpoints where a 401 is a real answer, not an expired access token.
const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

// Deduplicated refresh: concurrent 401s share one /auth/refresh call.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    // Plain axios (not `api`) so a failing refresh can't recurse.
    const res = await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true });
    const { user, token } = res.data.data;
    useAuthStore.getState().setAuth(user, token);
    return token;
  } catch {
    return null;
  }
}

// Response interceptor - on 401, try one silent refresh, then retry the request.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const is401 = error.response?.status === 401;
    const skip = !config || config._retry || NO_REFRESH_PATHS.some((p) => config.url?.includes(p));

    if (is401 && !skip) {
      config._retry = true;
      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
      const token = await refreshPromise;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      }
      // Refresh failed — the session is truly over.
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default api;
