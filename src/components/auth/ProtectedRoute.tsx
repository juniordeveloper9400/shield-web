import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canAccess } from '@/config/permissions';
import type { ModuleKey } from '@/types';

/**
 * Wraps a page so it only renders when the signed-in admin's role is allowed
 * to open `module`. Otherwise it redirects to login or the "no access" screen.
 */
export function ProtectedRoute({
  module,
  children,
}: {
  /** A page reachable from more than one sidebar entry (e.g. an agent's
   *  detail page, opened from both Agent approvals and the Agent Portal)
   *  passes every module that can lead here — allowed if the account has
   *  ANY of them, matching ModuleGuard's own OR semantics on the backend. */
  module: ModuleKey | ModuleKey[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const allowed = Array.isArray(module) ? module.some((m) => canAccess(user, m)) : canAccess(user, module);
  if (!allowed) {
    return <Navigate to="/no-access" replace />;
  }

  return <>{children}</>;
}
