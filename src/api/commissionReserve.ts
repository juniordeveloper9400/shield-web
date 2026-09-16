import { sql } from '@/lib/db';
import { iso, num } from '@/lib/mappers';

type Row = Record<string, unknown>;

export interface CommissionReserveEntry {
  id: string;
  walletCardId: string;
  amount: number;
  createdAt: string;
  /** Who activated the plan this reserve share came from, for context. */
  memberName: string;
  memberPhone: string;
  tierName: string;
}

export interface CommissionReserveSummary {
  total: number;
  entries: CommissionReserveEntry[];
}

/**
 * The company's own share of every approved Health Pass activation's
 * commission pool — see `app.commission_reserve_entry`'s own doc
 * (migration 0032/0033). `total` sums the ledger the same "the ledger is
 * the real figure" way every other running total in this console is read,
 * rather than trusting a separately maintained counter that could drift
 * from it. SUPERADMIN only — see `permissions.ts`'s own note on why this
 * module isn't in the shared Admin module list.
 */
export async function getCommissionReserve(): Promise<CommissionReserveSummary> {
  const rows = (await sql`
    SELECT
      cre.id, cre.wallet_card_id, cre.amount, cre.created_at,
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
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    tierName: String(r.tier_name ?? '—'),
  }));

  return {
    total: entries.reduce((sum, e) => sum + e.amount, 0),
    entries,
  };
}
