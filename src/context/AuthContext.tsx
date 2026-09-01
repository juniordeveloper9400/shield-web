import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '@/types';
import { adminForLoginId, authenticate } from '@/config/admins';

/** Where the signed-in admin's login id is kept so a reload stays signed in. */
const SESSION_KEY = 'shield-admin-session';

export interface LoginResult {
  ok: boolean;
  error?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True only for the first tick, while the stored session is restored. */
  loading: boolean;
  login: (loginId: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Sign-in for the console.
 *
 * Authenticates against the preset list in `src/config/admins.ts` — no
 * Firebase, no database round-trip. The signed-in email is persisted to
 * `localStorage` so a page reload does not drop the session; the password is
 * only ever checked at the moment of sign-in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        // Null when the login id has since been removed from the list.
        setUser(adminForLoginId(saved));
      }
    } catch {
      /* storage disabled (private window) — just start signed out */
    }
    setLoading(false);
  }, []);

  const login = useCallback(
    async (loginId: string, password: string): Promise<LoginResult> => {
      const resolved = authenticate(loginId, password);
      if (!resolved) {
        return { ok: false, error: 'Login ID or password is incorrect.' };
      }
      try {
        localStorage.setItem(SESSION_KEY, resolved.loginId);
      } catch {
        /* not fatal — the session just won't survive a reload */
      }
      setUser(resolved);
      return { ok: true };
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>.');
  return ctx;
}
