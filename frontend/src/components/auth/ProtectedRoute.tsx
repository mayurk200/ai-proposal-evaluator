import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/authStore';
import type { Role } from '@/types';

interface ProtectedRouteProps {
  children: ReactNode;
  /** If given, the user must hold one of these roles. */
  roles?: Role[];
}

/**
 * Gate for authenticated routes.
 *
 * Previously every page — dashboard, upload, proposals, settings — was routed
 * without any check, so the whole console was reachable while logged out. The
 * API is the real boundary (the gateway rejects tokenless requests), but the UI
 * should not be inviting people through a door that only slams at the end.
 */
export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { isAuthenticated, isHydrated, hasRole } = useAuthStore();
  const location = useLocation();

  // localStorage is read in an effect, so on a hard refresh we are briefly
  // "not authenticated" before hydration. Redirecting here would boot a
  // perfectly valid session back to the login page on every F5.
  if (!isHydrated) return null;

  if (!isAuthenticated) {
    // Remember where they were headed so login can send them back there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles?.length && !hasRole(...roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
