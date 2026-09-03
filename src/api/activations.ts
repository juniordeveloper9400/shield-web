import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type {
  PrivilegeActivation,
  PrivilegeActivationStatus,
  WalletActivity,
} from '@/types';

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
           wc.receipt_reference, wc.receipt_file_name, wc.receipt_image,
           wc.reviewer_note,
           wc.submitted_at, wc.reviewed_at, wc.issued_on, wc.expires_on,
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
    receiptImage: String(r.receipt_image ?? ''),
    reviewerNote: String(r.reviewer_note ?? ''),
    submittedAt: iso(r.submitted_at) ?? new Date(0).toISOString(),
    issuedOn: iso(r.issued_on) ?? '',
    expiresOn: iso(r.expires_on) ?? '',
    reviewedAt: iso(r.reviewed_at),
  }));
}

/**
 * A member's wallet at a glance — balance, points, and the recent ledger —
 * looked up from the wallet card being reviewed. Lets a reviewer see what the
 * plan will land on top of, and what has moved through the wallet already.
 */
export async function getWalletActivity(
  walletCardId: string,
): Promise<WalletActivity> {
  const walletRows = (await sql`
    SELECT w.balance, w.reward_points, w.opened_at
    FROM app.wallet_card wc
    JOIN app.wallet w ON w.id = wc.wallet_id
    WHERE wc.id = ${walletCardId}
  `) as Row[];

  const entryRows = (await sql`
    SELECT e.id, e.kind, e.label, e.amount, e.occurred_on
    FROM app.wallet_card wc
    JOIN app.wallet_entry e ON e.wallet_id = wc.wallet_id
    WHERE wc.id = ${walletCardId}
    ORDER BY e.occurred_on DESC, e.id DESC
    LIMIT 25
  `) as Row[];

  const w = walletRows[0] ?? {};
  return {
    balance: num(w.balance),
    rewardPoints: num(w.reward_points),
    openedAt: iso(w.opened_at) ?? null,
    entries: entryRows.map((r) => ({
      id: String(r.id),
      kind: fromEnum(String(r.kind ?? '')),
      label: String(r.label ?? ''),
      amount: num(r.amount),
      occurredOn: iso(r.occurred_on) ?? '',
    })),
  };
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
