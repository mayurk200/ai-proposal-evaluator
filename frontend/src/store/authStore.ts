import { create } from 'zustand';
import type { User, Role } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  /** False until loadFromStorage() has run, so guards don't bounce a logged-in user on refresh. */
  isHydrated: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  loadFromStorage: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isHydrated: false,

  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ user, token, isAuthenticated: true, isHydrated: true });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ user: null, token: null, isAuthenticated: false, isHydrated: true });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (!token || !userStr) {
      set({ isHydrated: true });
      return;
    }

    try {
      set({
        user: JSON.parse(userStr) as User,
        token,
        isAuthenticated: true,
        isHydrated: true,
      });
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({ isHydrated: true });
    }
  },

  /**
   * Role check for hiding controls the user cannot use.
   *
   * This is a UX affordance only — the gateway enforces the same rule on every
   * decision route. A hidden button is not a permission.
   */
  hasRole: (...roles: Role[]) => {
    const role = get().user?.role;
    return !!role && roles.includes(role);
  },
}));
