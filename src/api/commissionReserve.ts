import { sql } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import { reserveByStore } from '@/lib/reserveByStore';

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
 * the store its activation was made at (`wallet_card.store_id`). Callers scope
 * what they show with `scopeToStore`; this returns every store.
 */
export async function getCommissionReserve(): Promise<CommissionReserveSummary> {
  const rows = (await sql`
    SELECT
      cre.id, cre.wallet_card_id, cre.amount, cre.source, cre.created_at,
      m.name AS member_name, m.phone AS member_phone,
      mt.name AS tier_name,
      wc.store_id, s.code AS store_code, s.name AS store_name
    FROM app.commission_reserve_entry cre
    JOIN app.wallet_card wc ON wc.id = cre.wallet_card_id
    JOIN app.wallet w       ON w.id  = wc.wallet_id
    JOIN app.users m        ON m.id  = w.member_id
    JOIN app.membership_tier mt ON mt.id = wc.tier_id
    LEFT JOIN app.shield_store s ON s.id = wc.store_id
    ORDER BY cre.created_at DESC
  `) as Row[];

  const entries: CommissionReserveEntry[] = rows.map((r) => ({
    id: String(r.id),
    walletCardId: String(r.wallet_card_id),
    amount: num(r.amount),
    source: (r.source === 'COMPANY_SHARE' ? 'COMPANY_SHARE' : 'POOL_LEFTOVER') as ReserveSource,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    tierName: String(r.tier_name ?? '—'),
    storeId: r.store_id == null ? '' : String(r.store_id),
    storeCode: String(r.store_code ?? ''),
    storeName: r.store_id == null ? 'Unassigned' : String(r.store_name ?? '—'),
  }));

  const sumOf = (source: ReserveSource, list: CommissionReserveEntry[] = entries) =>
    list.filter((e) => e.source === source).reduce((sum, e) => sum + e.amount, 0);

  const byStore = reserveByStore(entries);

  return {
    total: entries.reduce((sum, e) => sum + e.amount, 0),
    companyShare: sumOf('COMPANY_SHARE'),
    poolLeftover: sumOf('POOL_LEFTOVER'),
    byStore,
    entries,
  };
}
