import { api } from '@/lib/api';
import { iso, num } from '@/lib/mappers';

type Row = Record<string, unknown>;

/**
 * Where a reserve row came from (`app.commission_reserve_entry.source`,
 * migration 0053): the company's own 8% of an activation, or the unspent part
 * of an agent sale's commission pool.
 */
export type ReserveSource = 'COMPANY_SHARE' | 'POOL_LEFTOVER';

export interface CommissionReserveEntry {
  id: string;
  walletCardId: string;
  amount: number;
  source: ReserveSource;
  createdAt: string;
  /** Who activated the plan this reserve share came from, for context. */
  memberName: string;
  memberPhone: string;
  tierName: string;
  /** The store the activation was made at (`wallet_card.store_id`); '' when
   *  none was recorded — shown as "Unassigned". */
  storeId: string;
  storeCode: string;
  storeName: string;
}

/** One store's slice of the reserve, for the "By store" table. */
export interface CommissionReserveStore {
  /** Stable row key: the store id, or "unassigned". */
  id: string;
  /** '' for activations with no store recorded. */
  storeId: string;
  storeCode: string;
  storeName: string;
  total: number;
  companyShare: number;
  poolLeftover: number;
}

export interface CommissionReserveSummary {
  total: number;
  /** The company's 8% of every activation. */
  companyShare: number;
  /** The unspent part of agent sales' commission pools. */
  poolLeftover: number;
  /** Every store's reserve, largest first. */
  byStore: CommissionReserveStore[];
  entries: CommissionReserveEntry[];
}

/**
 * The company's own money from Health Pass activations: 8% of every approved
 * activation, plus whatever an agent sale's commission pool left unspent — see
 * `app.commission_reserve_entry`'s own doc (migrations 0032/0033/0053). `total`
 * sums the ledger, never a separately kept counter. Each row is attributed to
 * the store its activation was made at (`wallet_card.store_id`), and the
 * split by store, scoped to this staff member's role/branch, is computed by
 * backend/api (WalletService.getCommissionReserve) — the browser no longer
 * reads the ledger or does that grouping itself.
 */
export async function getCommissionReserve(
  token: string | null,
): Promise<CommissionReserveSummary> {
  const data = await api.get<Row>('/v1/staff/wallet-cards/reserve', token);

  const entries: CommissionReserveEntry[] = (data.entries as Row[]).map((r) => ({
    id: String(r.id),
    walletCardId: String(r.walletCardId),
    amount: num(r.amount),
    source: (r.source === 'COMPANY_SHARE' ? 'COMPANY_SHARE' : 'POOL_LEFTOVER') as ReserveSource,
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
    memberName: String(r.memberName ?? '—'),
    memberPhone: String(r.memberPhone ?? ''),
    tierName: String(r.tierName ?? '—'),
    storeId: r.storeId == null ? '' : String(r.storeId),
    storeCode: String(r.storeCode ?? ''),
    storeName: String(r.storeName ?? '—'),
  }));

  const byStore: CommissionReserveStore[] = (data.byStore as Row[]).map((b) => ({
    id: String(b.id),
    storeId: b.storeId == null ? '' : String(b.storeId),
    storeCode: String(b.storeCode ?? ''),
    storeName: String(b.storeName ?? '—'),
    total: num(b.total),
    companyShare: num(b.companyShare),
    poolLeftover: num(b.poolLeftover),
  }));

  return {
    total: num(data.total),
    companyShare: num(data.companyShare),
    poolLeftover: num(data.poolLeftover),
    byStore,
    entries,
  };
}
