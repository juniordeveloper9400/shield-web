import { api } from '@/lib/api';

export interface LedgerEntity {
  id: number;
  code: string;
  name: string;
  isProvisional: boolean;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isProvisional: boolean;
  debit: number;
  credit: number;
  net: number;
}

export interface LedgerPeriod {
  id: number;
  entityId: number;
  period: string;
  closedAt: string | null;
  closedBy: string | null;
}

export interface ChartOfAccount {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  isProvisional: boolean;
}

export interface SubjectLedgerLine {
  id: number;
  postedOn: string;
  description: string;
  event: string;
  debit: number;
  credit: number;
}

export interface SubjectLedger {
  accountCode: string;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  openingBalance: number;
  debit: number;
  credit: number;
  closingBalance: number;
  lines: SubjectLedgerLine[];
}

/**
 * Backend/api's `/v1/staff/ledger/*` routes (migrations 0074–0077) — the
 * double-entry journal underneath the existing per-module money tables.
 * Every account and posting rule is provisional until an accountant
 * reviews it; see `isProvisional` on both entities and accounts, and the
 * Suspense account (code `9000`) on the Head Office trial balance, which
 * carries the gap between an activation's cash receipt and the bonus,
 * commissions and reserves it commits to — a revenue-recognition question
 * for the accountant, not an error.
 */
export function getLedgerEntities(token: string | null): Promise<LedgerEntity[]> {
  return api.get('/v1/staff/ledger/entities', token);
}

export function getTrialBalance(
  token: string | null,
  params: { entityId?: number; period?: string; type?: string },
): Promise<TrialBalanceRow[]> {
  const q = new URLSearchParams();
  if (params.entityId !== undefined) q.set('entityId', String(params.entityId));
  if (params.period) q.set('period', params.period);
  if (params.type) q.set('type', params.type);
  const qs = q.toString();
  return api.get(`/v1/staff/ledger/trial-balance${qs ? `?${qs}` : ''}`, token);
}

export function getLedgerPeriods(token: string | null, entityId?: number): Promise<LedgerPeriod[]> {
  const qs = entityId !== undefined ? `?entityId=${entityId}` : '';
  return api.get(`/v1/staff/ledger/periods${qs}`, token);
}

export function closeLedgerPeriod(
  token: string | null,
  entityId: number,
  period: string,
): Promise<LedgerPeriod> {
  return api.post(`/v1/staff/ledger/entities/${entityId}/periods/close`, { period }, token);
}

export function getChartOfAccounts(token: string | null): Promise<ChartOfAccount[]> {
  return api.get('/v1/staff/ledger/accounts', token);
}

/** One subject's (member/agent/investor) Debit, Credit and running Closing
 *  balance for one account, for one month — see migration 0090's own doc on
 *  why this differs from `getTrialBalance`'s store-wide movement-only rows. */
export function getSubjectLedger(
  token: string | null,
  params: { subjectType: string; subjectId: number; accountCode: string; period: string; entityId?: number },
): Promise<SubjectLedger> {
  const q = new URLSearchParams();
  q.set('subjectType', params.subjectType);
  q.set('subjectId', String(params.subjectId));
  q.set('accountCode', params.accountCode);
  q.set('period', params.period);
  if (params.entityId !== undefined) q.set('entityId', String(params.entityId));
  return api.get(`/v1/staff/ledger/subject-ledger?${q.toString()}`, token);
}
