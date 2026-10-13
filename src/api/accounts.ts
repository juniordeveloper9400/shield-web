import { api } from '@/lib/api';
import type {
  MemberMoneyFlowSummary,
  MoneyFlowEntry,
  MoneyFlowKind,
  MoneyFlowSummary,
  MonthlyMoneyFlow,
} from '@/types';

/**
 * The Accounts page's headline numbers — built by backend/api
 * (AccountsService) under the signed-in staff member's session; the
 * browser no longer reads these straight from the database. See that
 * service's own doc for the exclusion rules (CANCELLED orders/bookings/
 * appointments, PENDING activations don't count until approved).
 */
export async function getMoneyFlowSummary(token: string | null): Promise<MoneyFlowSummary> {
  return api.get<MoneyFlowSummary>('/v1/staff/accounts/money-flow-summary', token);
}

const KIND_LABEL: Record<MoneyFlowKind, string> = {
  order: 'Order payment',
  lab_booking: 'Lab test payment',
  appointment: 'Appointment fee',
  privilege_load: 'Health Pass plan load',
  agent_payout: 'Agent payout',
};

export function moneyFlowKindLabel(kind: MoneyFlowKind): string {
  return KIND_LABEL[kind];
}

/** The {@link Badge} tone each {@link MoneyFlowKind} renders with — shared so
 *  the Accounts page, a member's own ledger tab, and the printable ledger
 *  report all colour the same kind of entry the same way. */
const KIND_TONE: Record<MoneyFlowKind, 'blue' | 'violet' | 'green' | 'amber' | 'red'> = {
  order: 'blue',
  lab_booking: 'violet',
  appointment: 'green',
  privilege_load: 'amber',
  agent_payout: 'red',
};

export function moneyFlowKindTone(kind: MoneyFlowKind): 'blue' | 'violet' | 'green' | 'amber' | 'red' {
  return KIND_TONE[kind];
}

/**
 * Every settled money movement — order payments, lab and appointment fees,
 * approved privilege-plan loads (all money in), and paid agent withdrawals
 * (money out) — merged into one timeline, newest first.
 */
export async function listMoneyFlowEntries(limit: number, token: string | null): Promise<MoneyFlowEntry[]> {
  return api.get<MoneyFlowEntry[]>(`/v1/staff/accounts/money-flow-entries?limit=${limit}`, token);
}

/**
 * One member's own transaction history — the same five sources as
 * {@link listMoneyFlowEntries}, scoped to just their rows. Used by the
 * "Transaction history" tab on the user detail page.
 */
export async function listMemberTransactions(
  memberId: string,
  token: string | null,
  limit = 200,
): Promise<MoneyFlowEntry[]> {
  return api.get<MoneyFlowEntry[]>(`/v1/staff/accounts/member-transactions/${memberId}?limit=${limit}`, token);
}

/**
 * Revenue in vs. payouts out, grouped by calendar month, for the trailing
 * `months` months (default the current month plus the 5 before it).
 */
export async function getMonthlyMoneyFlow(months: number, token: string | null): Promise<MonthlyMoneyFlow[]> {
  return api.get<MonthlyMoneyFlow[]>(`/v1/staff/accounts/monthly-money-flow?months=${months}`, token);
}

/**
 * Every member's own money-flow totals in one round trip, alongside their
 * current wallet balance. Backs the Accounts page's "All members" table; a
 * row's own full history is {@link listMemberTransactions}, on that
 * member's own detail page.
 */
export async function listMemberMoneyFlowSummaries(token: string | null): Promise<MemberMoneyFlowSummary[]> {
  return api.get<MemberMoneyFlowSummary[]>('/v1/staff/accounts/member-summaries', token);
}
