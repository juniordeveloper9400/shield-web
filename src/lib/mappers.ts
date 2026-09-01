import type { Role } from '@/types';

/**
 * The `app` schema stores closed sets as UPPER_SNAKE Postgres enums
 * (`PROCESSING`, `AWAITING_REVIEW`, `SUPERADMIN`, …). The admin console works
 * in lower_snake throughout. These two helpers are the only place that gap is
 * bridged.
 */
export const toEnum = (value: string): string => value.toUpperCase();
export const fromEnum = <T extends string>(value: string): T =>
  value.toLowerCase() as T;

/** `app.admin_role` <-> the console's `Role`. */
export const roleFromDb = (value: string): Role =>
  value.toLowerCase() as Role;
export const roleToDb = (role: Role): string => role.toUpperCase();

/** A Postgres `timestamptz` / `Date` from a query → an ISO string or undefined. */
export function iso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Same, but never undefined — falls back to the epoch for a missing date. */
export function isoRequired(value: unknown): string {
  return iso(value) ?? new Date(0).toISOString();
}

/** A numeric column (Postgres `numeric` comes back as a string) → number. */
export function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return 0;
}
