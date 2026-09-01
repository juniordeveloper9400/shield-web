import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await login(loginId, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Unable to sign in.');
      return;
    }
    const state = location.state as LocationState | null;
    const target =
      state?.from?.pathname && state.from.pathname !== '/login'
        ? state.from.pathname
        : '/';
    navigate(target, { replace: true });
  }

  return (
    <div className="flex min-h-full">
      {/* Brand panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-brand-700 p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/15">
            <img src="/shield_mark.png" alt="SHIELD" className="h-6 w-6 object-contain" />
          </span>
          <span className="text-lg font-semibold">SHIELD Admin</span>
        </div>

        <div>
          <h1 className="text-3xl font-semibold leading-tight">
            One console for SHIELD orders, prescriptions, lab tests & appointments.
          </h1>
          <p className="mt-4 max-w-md text-brand-100">
            Sign in with your work email. The pages you can open are decided by
            the role attached to your account.
          </p>
        </div>

        <p className="text-sm text-brand-200">
          &copy; {new Date().getFullYear()} Shield Health Platform
        </p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-white ring-1 ring-slate-200">
                <img src="/shield_mark.png" alt="SHIELD" className="h-6 w-6 object-contain" />
              </span>
              <span className="text-lg font-semibold text-slate-900">
                SHIELD Admin
              </span>
            </div>
          </div>

          <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            Use the login ID and password for your admin account.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="loginId"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Login ID
              </label>
              <input
                id="loginId"
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. pharmacy_mel"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-xs text-slate-400">
            Logins are preset in the console configuration. Ask your
            administrator to add one or change a password.
          </p>
        </div>
      </div>
    </div>
  );
}
