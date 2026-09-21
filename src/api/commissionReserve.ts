import { sql } from '@/lib/db';
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
}

export interface CommissionReserveSummary {
  total: number;
  /** The company's 8% of every activation. */
  companyShare: number;
  /** The unspent part of agent sales' commission pools. */
  poolLeftover: number;
  entries: CommissionReserveEntry[];
}

/**
 * The company's own money from Health Pass activations: 8% of every approved
 * activation, plus whatever an agent sale's commission pool left unspent — see
 * `app.commission_reserve_entry`'s own doc (migrations 0032/0033/0053). `total` sums the ledger the same "the ledger is
 * the real figure" way every other running total in this console is read,
 * rather than trusting a separately maintained counter that could drift
 * from it. SUPERADMIN only — see `permissions.ts`'s own note on why this
 * module isn't in the shared Admin module list.
 */
export async function getCommissionReserve(): Promise<CommissionReserveSummary> {
  const rows = (await sql`
    SELECT
      cre.id, cre.wallet_card_id, cre.amount, cre.source, cre.created_at,
      m.name AS member_name, m.phone AS member_phone,
      mt.name AS tier_name
    FROM app.commission_reserve_entry cre
    JOIN app.wallet_card wc ON wc.id = cre.wallet_card_id
    JOIN app.wallet w       ON w.id  = wc.wallet_id
    JOIN app.users m        ON m.id  = w.member_id
    JOIN app.membership_tier mt ON mt.id = wc.tier_id
    ORDER BY cre.created_at DESC
  `) as Row[];

  const entries = rows.map((r) => ({
    id: String(r.id),
    walletCardId: String(r.wallet_card_id),
    amount: num(r.amount),
    source: (r.source === 'COMPANY_SHARE' ? 'COMPANY_SHARE' : 'POOL_LEFTOVER') as ReserveSource,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    tierName: String(r.tier_name ?? '—'),
  }));

  const sumOf = (source: ReserveSource) =>
    entries.filter((e) => e.source === source).reduce((sum, e) => sum + e.amount, 0);

  return {
    total: entries.reduce((sum, e) => sum + e.amount, 0),
    companyShare: sumOf('COMPANY_SHARE'),
    poolLeftover: sumOf('POOL_LEFTOVER'),
    entries,
  };
}
