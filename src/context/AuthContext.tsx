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
import { api, ApiError, registerUnauthorizedHandler } from '@/lib/api';
import type { AuthUser, Role } from '@/types';

/** Where the refresh token is kept so a reload doesn't drop the session. */
const REFRESH_TOKEN_KEY = 'shield-admin-refresh-token';

const ROLE_COLOR: Record<Role, string> = {
  superadmin: '#2c57a6',
  admin: '#0f766e',
  pharmacy: '#1f7a4d',
  lab: '#8a5b1f',
  appointments: '#6b3fa0',
  delivery: '#c2410c',
  lab_technician: '#a1650d',
};

interface StaffSessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface StaffProfileResponse {
  id: number;
  loginId: string;
  name: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'PHARMACY' | 'LAB' | 'APPOINTMENTS' | 'DELIVERY' | 'LAB_TECHNICIAN';
  storeId: number | null;
  storeCode: string | null;
  isActive: boolean;
}

function toAuthUser(profile: StaffProfileResponse): AuthUser {
  const role = profile.role.toLowerCase() as Role;
  return {
    id: String(profile.id),
    loginId: profile.loginId,
    name: profile.name,
    role,
    avatarColor: ROLE_COLOR[role],
    status: profile.isActive ? 'active' : 'suspended',
    storeCode:
      role === 'pharmacy' || role === 'delivery' || role === 'lab_technician'
        ? (profile.storeCode ?? undefined)
        : undefined,
    lastLogin: new Date().toISOString(),
  };
}

function loginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Login ID or password is incorrect.';
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
  login: (loginId: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Sign-in for the console.
 *
 * Login id + password, checked directly by the backend (backend/api/, see
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
  // Concurrent 401s (a page that fires several calls at once) must not each
  // spend their own refresh token on a separate round trip — they share
  // whichever attempt is already in flight instead.
  const refreshInFlight = useRef<Promise<string | null> | null>(null);

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

  /**
   * Trades the persisted refresh token for a new session, the one place
   * that actually happens — the reload-time restore below and a live 401
   * (see `api.ts`'s `registerUnauthorizedHandler`) both call this rather
   * than each keeping their own copy of the exchange. Null means signed
   * out for real: no refresh token to begin with, or the backend rejected
   * the one there was (expired, revoked, or itself unreachable) — either
   * way nothing to retry a request with, so this also clears the session
   * rather than leaving the admin clicking into the same 401 forever.
   */
  const refreshAccessToken = useCallback((): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;

    const attempt = (async () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(REFRESH_TOKEN_KEY);
      } catch {
        /* ignore */
      }
      if (!stored) return null;

      try {
        const session = await api.post<StaffSessionResponse>('/v1/staff/auth/refresh', {
          refreshToken: stored,
        });
        await establishSession(session);
        return session.accessToken;
      } catch {
        accessTokenRef.current = null;
        setAccessToken(null);
        setUser(null);
        try {
          localStorage.removeItem(REFRESH_TOKEN_KEY);
        } catch {
          /* ignore */
        }
        return null;
      }
    })();

    refreshInFlight.current = attempt;
    return attempt.finally(() => {
      refreshInFlight.current = null;
    });
  }, [establishSession]);

  // Any call anywhere in the console that hits a 401 on a token it sent
  // routes through this same exchange — see api.ts's own doc.
  useEffect(() => {
    registerUnauthorizedHandler(refreshAccessToken);
    return () => registerUnauthorizedHandler(null);
  }, [refreshAccessToken]);

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

      await refreshAccessToken();
      if (!cancelled) setLoading(false);
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [refreshAccessToken]);

  const login = useCallback(
    async (loginId: string, password: string): Promise<LoginResult> => {
      try {
        const session = await api.post<StaffSessionResponse>('/v1/staff/auth/session', {
          loginId: loginId.trim(),
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
