import { api } from '@/lib/api';

export type AuditAction = 'LOGIN' | 'LOGIN_FAILED' | 'CREATE' | 'UPDATE' | 'DELETE';

/** A `GET /v1/staff/audit-log` row — the backend's own snapshot columns
 *  already carry everything needed to render a line (staff name/login/role
 *  at the time of the action), so there's no join to do client-side. */
export interface AuditLogEntry {
  id: string;
  staffId: string | null;
  staffLoginId: string;
  staffName: string;
  staffRole: string;
  storeId: string | null;
  action: AuditAction;
  method: string;
  path: string;
  statusCode: number;
  requestBody: unknown;
  ip: string | null;
  createdAt: string;
}

interface AuditLogApiRow {
  id: number;
  staffId: number | null;
  staffLoginId: string;
  staffName: string;
  staffRole: string;
  storeId: number | null;
  action: AuditAction;
  method: string;
  path: string;
  statusCode: number;
  requestBody: unknown;
  ip: string | null;
  createdAt: string;
}

function toEntry(r: AuditLogApiRow): AuditLogEntry {
  return {
    id: String(r.id),
    staffId: r.staffId == null ? null : String(r.staffId),
    staffLoginId: r.staffLoginId,
    staffName: r.staffName,
    staffRole: r.staffRole,
    storeId: r.storeId == null ? null : String(r.storeId),
    action: r.action,
    method: r.method,
    path: r.path,
    statusCode: r.statusCode,
    requestBody: r.requestBody,
    ip: r.ip,
    createdAt: r.createdAt,
  };
}

export interface AuditLogFilters {
  staffId?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
}

/** The Super Admin's own report: every staff login and every mutating
 *  action across the console, newest first. [filters.cursor] is the last
 *  page's own `nextCursor`, for "load more". */
export async function listAuditLog(
  filters: AuditLogFilters,
  token: string | null,
): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (filters.staffId) params.set('staffId', filters.staffId);
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.q) params.set('q', filters.q);
  if (filters.cursor) params.set('cursor', filters.cursor);
  const qs = params.toString();
  const res = await api.get<{ items: AuditLogApiRow[]; nextCursor: number | null }>(
    `/v1/staff/audit-log${qs ? `?${qs}` : ''}`,
    token,
  );
  return { items: res.items.map(toEntry), nextCursor: res.nextCursor == null ? null : String(res.nextCursor) };
}
