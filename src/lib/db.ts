import { neon } from '@neondatabase/serverless';

/**
 * Direct Neon Postgres access from the browser over HTTPS.
 *
 * `@neondatabase/serverless` speaks Neon's SQL-over-HTTP endpoint, so no
 * connection pool or socket is involved — each call is one `fetch`. The
 * connection string is read from `VITE_DATABASE_URL`, which Vite inlines into
 * the bundle: acceptable only because this console is staff-only and sits
 * behind the Firebase login. A public deployment would need a server API here
 * instead.
 *
 * `sql` is a tagged-template function: interpolations are sent as bound
 * parameters, never string-concatenated, so `${value}` is injection-safe.
 *
 *   const rows = await sql`SELECT * FROM app.member WHERE id = ${id}`;
 *
 * For a query built at runtime, use `sql.query(text, params)` with `$1` holes.
 */
const connectionString = import.meta.env.VITE_DATABASE_URL;

export const isDbConfigured = Boolean(connectionString);

if (!isDbConfigured && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.warn(
    'VITE_DATABASE_URL is not set — every data screen will fail to load. ' +
      'Copy .env.example to .env.local and fill it in.',
  );
}

export const sql = neon(connectionString ?? 'postgresql://unset');

/** Narrow helper for `sql.query` results (already a plain row array). */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await sql.query(text, params)) as T[];
}

/** A human-readable message for a failed query, for surfacing in the UI. */
export function dbErrorMessage(error: unknown): string {
  if (!isDbConfigured) {
    return 'The database is not configured (VITE_DATABASE_URL). See .env.example.';
  }
  if (error instanceof Error) return error.message;
  return 'The database request failed.';
}
