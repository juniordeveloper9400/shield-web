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
  module: ModuleKey;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!canAccess(user.role, module)) {
    return <Navigate to="/no-access" replace />;
  }

  return <>{children}</>;
}
