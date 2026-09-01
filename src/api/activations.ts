import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type { PrivilegeActivation, PrivilegeActivationStatus } from '@/types';

type Row = Record<string, unknown>;

/**
 * Every privilege-plan activation members have submitted — `app.wallet_card`
 * joined to its member, tier and branch. Pending first, then newest.
 */
export async function listActivations(): Promise<PrivilegeActivation[]> {
  const rows = (await sql`
    SELECT wc.id, wc.uuid,
           m.name  AS member_name,
           m.phone AS member_phone,
           mt.name AS tier_name,
           mt.kind AS tier_kind,
           wc.amount, wc.bonus, wc.recharged_extra,
           wc.status, wc.card_number,
           wc.receipt_reference, wc.receipt_file_name, wc.reviewer_note,
           wc.submitted_at, wc.reviewed_at,
           s.code AS store_code,
           s.name AS store_name
    FROM app.wallet_card wc
    JOIN app.wallet w           ON w.id  = wc.wallet_id
    JOIN app.users m            ON m.id  = w.member_id
    JOIN app.membership_tier mt ON mt.id = wc.tier_id
    LEFT JOIN app.shield_store s ON s.id = wc.store_id
    ORDER BY (wc.status = 'PENDING') DESC, wc.submitted_at DESC
  `) as Row[];

  return rows.map((r) => ({
    id: String(r.id),
    uuid: String(r.uuid),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    tier: String(r.tier_name ?? '—'),
    tierKind: fromEnum(String(r.tier_kind ?? '')),
    amount: num(r.amount),
    bonus: num(r.bonus),
    credited: num(r.amount) + num(r.bonus) + num(r.recharged_extra),
    status: fromEnum<PrivilegeActivationStatus>(String(r.status)),
    storeCode: String(r.store_code ?? ''),
    storeName: String(r.store_name ?? '—'),
    cardNumber: String(r.card_number ?? ''),
    receiptReference: String(r.receipt_reference ?? ''),
    receiptFileName: String(r.receipt_file_name ?? ''),
    reviewerNote: String(r.reviewer_note ?? ''),
    submittedAt: iso(r.submitted_at) ?? new Date(0).toISOString(),
    reviewedAt: iso(r.reviewed_at),
  }));
}

/**
 * Approves a pending activation in one statement: flips the card to
 * `APPROVED`, writes the `ACTIVATION` + `BONUS` ledger lines, credits the
 * wallet balance (load + bonus) and stamps `opened_at`. A no-op — and returns
 * `false` — if the card is not `PENDING` (already decided, or a stale id).
 */
export async function approveActivation(id: string): Promise<boolean> {
  const rows = await query<Row>(
    `
    WITH card AS (
      UPDATE app.wallet_card
         SET status = 'APPROVED', reviewed_at = now()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING id, wallet_id, tier_id, amount, bonus
    ),
    tier AS (
      SELECT c.id, c.wallet_id, c.amount, c.bonus, mt.name AS tier_name
      FROM card c
      JOIN app.membership_tier mt ON mt.id = c.tier_id
    ),
    ledger AS (
      INSERT INTO app.wallet_entry
        (wallet_id, kind, label, amount, occurred_on, wallet_card_id)
      SELECT wallet_id, 'ACTIVATION'::app.wallet_entry_kind,
             tier_name || ' activation', amount, current_date, id FROM tier
      UNION ALL
      SELECT wallet_id, 'BONUS'::app.wallet_entry_kind,
             tier_name || ' bonus · 10%', bonus, current_date, id FROM tier
      RETURNING 1
    ),
    balance AS (
      UPDATE app.wallet w
         SET balance    = w.balance + (SELECT amount + bonus FROM tier),
             opened_at  = COALESCE(w.opened_at, now()),
             updated_at = now()
       WHERE w.id = (SELECT wallet_id FROM tier)
       RETURNING w.id
    )
    SELECT id FROM card
    `,
    [id],
  );
  return rows.length > 0;
}

/**
 * Rejects a pending activation with a reason the member sees in their wallet.
 * Nothing is credited. Returns `false` if the card was not `PENDING`.
 */
export async function rejectActivation(
  id: string,
  note: string,
): Promise<boolean> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error('A rejection needs a reason.');
  const rows = await query<Row>(
    `
    UPDATE app.wallet_card
       SET status = 'REJECTED', reviewer_note = $2, reviewed_at = now()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING id
    `,
    [id, trimmed],
  );
  return rows.length > 0;
}
