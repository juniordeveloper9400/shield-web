/**
 * Typed client for backend/api (backend/docs/) — the new backend service.
 * Currently used for staff auth only; data operations still go through
 * `lib/db.ts` (direct Neon) until each module is migrated in turn — see
 * backend/docs/migration-plan.md Phase 1.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL;

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

/**
 * Gets a fresh access token from a live refresh token, or null when there
 * isn't one (signed out already) or the refresh itself failed (refresh
 * token expired/revoked too — nothing left to do but let the 401 through).
 * `AuthContext` is the one registration, on mount — see its own doc on why
 * this lives here rather than every page thread its own retry around every
 * `api.*()` call.
 */
type UnauthorizedHandler = () => Promise<string | null>;
let onUnauthorized: UnauthorizedHandler | null = null;
export function registerUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

async function request<T>(path: string, opts: RequestOptions = {}, isRetry = false): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const json = (await res.json().catch(() => null)) as (T & ErrorEnvelope) | ErrorEnvelope | null;

  if (!res.ok) {
    const err = (json as ErrorEnvelope | null)?.error ?? { code: 'ERROR', message: res.statusText };
    // Only a call that actually carried a bearer token can fail because
    // *that* token expired — login (no token sent yet) and the refresh
    // call itself (its own 401 means the refresh token is dead, not the
    // access token) both skip this and surface their real error as before.
    if (res.status === 401 && opts.token && !isRetry && onUnauthorized) {
      const fresh = await onUnauthorized();
      if (fresh) {
        return request<T>(path, { ...opts, token: fresh }, true);
      }
    }
    throw new ApiError(res.status, err.code, err.message, err.details);
  }

  return json as T;
}

export const api = {
  get: <T>(path: string, token?: string | null) => request<T>(path, { token }),
  post: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'POST', body, token }),
  patch: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'PATCH', body, token }),
  put: <T>(path: string, body?: unknown, token?: string | null) =>
    request<T>(path, { method: 'PUT', body, token }),
  delete: <T>(path: string, token?: string | null) => request<T>(path, { method: 'DELETE', token }),
};
