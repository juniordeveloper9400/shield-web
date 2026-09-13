import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import type { AuthUser, Role } from '@/types';

/** Where the refresh token is kept so a reload doesn't drop the session. */
const REFRESH_TOKEN_KEY = 'shield-admin-refresh-token';

const ROLE_COLOR: Record<Role, string> = {
  superadmin: '#2c57a6',
  admin: '#0f766e',
  pharmacy: '#1f7a4d',
  lab: '#8a5b1f',
  appointments: '#6b3fa0',
};

interface StaffSessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface StaffProfileResponse {
  id: number;
  email: string;
  name: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'PHARMACY' | 'LAB' | 'APPOINTMENTS';
  storeId: number | null;
  storeCode: string | null;
  isActive: boolean;
}

function toAuthUser(profile: StaffProfileResponse): AuthUser {
  const role = profile.role.toLowerCase() as Role;
  return {
    id: String(profile.id),
    loginId: profile.email,
    name: profile.name,
    role,
    avatarColor: ROLE_COLOR[role],
    status: profile.isActive ? 'active' : 'suspended',
    storeCode: role === 'pharmacy' ? (profile.storeCode ?? undefined) : undefined,
    lastLogin: new Date().toISOString(),
  };
}

function loginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Email or password is incorrect.';
    if (err.status === 403) return 'This account has been deactivated.';
    if (err.status === 429) return 'Too many attempts — wait a moment and try again.';
  }
  return 'Unable to sign in. Please try again.';
}

export interface LoginResult {
  ok: boolean;
  error?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True only for the first tick, while a stored session is restored. */
  loading: boolean;
  /** The backend's short-lived access token — for pages calling backend/api directly. Null when signed out. */
  accessToken: string | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Sign-in for the console.
 *
 * Email + password, checked directly by the backend (backend/api/, see
 * backend/docs/) against a bcrypt hash on app.admin_user — no Firebase
 * involved for staff at all (member login stays Firebase phone-auth,
 * unrelated). The backend issues its own session: a short-lived access
 * token (kept in memory) plus a refresh token (persisted so a reload
 * doesn't sign the admin out). Replaces the static credential list that
 * used to live in `config/admins.ts`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // Logout needs the *current* token without forcing every token refresh to
  // re-create the callback — a ref mirrors the state for that one read.
  const accessTokenRef = useRef<string | null>(null);

  const establishSession = useCallback(async (session: StaffSessionResponse) => {
    accessTokenRef.current = session.accessToken;
    setAccessToken(session.accessToken);
    try {
      localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
    } catch {
      /* private window / storage disabled — session just won't survive a reload */
    }
    const profile = await api.get<StaffProfileResponse>('/v1/staff/me', session.accessToken);
    setUser(toAuthUser(profile));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(REFRESH_TOKEN_KEY);
      } catch {
        /* ignore */
      }

      if (!stored) {
        setLoading(false);
        return;
      }

      try {
        const session = await api.post<StaffSessionResponse>('/v1/staff/auth/refresh', {
          refreshToken: stored,
        });
        if (cancelled) return;
        await establishSession(session);
      } catch {
        // Refresh token expired, revoked, or the backend is unreachable —
        // start signed out rather than stuck loading.
        try {
          localStorage.removeItem(REFRESH_TOKEN_KEY);
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [establishSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      try {
        const session = await api.post<StaffSessionResponse>('/v1/staff/auth/session', {
          email: email.trim(),
          password,
        });
        await establishSession(session);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: loginError(err) };
      }
    },
    [establishSession],
  );

  const logout = useCallback(async () => {
    const token = accessTokenRef.current;
    if (token) {
      await api.delete('/v1/staff/auth/session', token).catch(() => undefined);
    }
    accessTokenRef.current = null;
    setAccessToken(null);
    try {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, accessToken, login, logout }),
    [user, loading, accessToken, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>.');
  return ctx;
}
