import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type {
  PrivilegeActivation,
  PrivilegeActivationStatus,
  WalletActivity,
} from '@/types';

type Row = Record<string, unknown>;

/** `app.wallet_card` + member + tier + branch → the shape the console renders. */
function toActivation(r: Row): PrivilegeActivation {
  return {
    id: String(r.id),
    uuid: String(r.uuid),
    memberId: String(r.member_id ?? ''),
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
    verifiedReference: String(r.verified_reference ?? ''),
    receivedOn: iso(r.received_on) ?? '',
    receiptVerified: r.receipt_verified === true,
    receivedAmount: num(r.received_amount),
  };
}

const ACTIVATION_COLUMNS = `
    wc.id, wc.uuid,
    w.member_id AS member_id,
    m.name  AS member_name,
    m.phone AS member_phone,
    mt.name AS tier_name,
    mt.kind AS tier_kind,
    wc.amount, wc.bonus, wc.recharged_extra,
    wc.status, wc.card_number,
    wc.receipt_reference, wc.receipt_file_name, wc.receipt_image,
    wc.reviewer_note,
    wc.submitted_at, wc.reviewed_at, wc.issued_on, wc.expires_on,
    wc.verified_reference, wc.received_on, wc.receipt_verified, wc.received_amount,
    s.code AS store_code,
    s.name AS store_name
  FROM app.wallet_card wc
  JOIN app.wallet w           ON w.id  = wc.wallet_id
  JOIN app.users m            ON m.id  = w.member_id
  JOIN app.membership_tier mt ON mt.id = wc.tier_id
  LEFT JOIN app.shield_store s ON s.id = wc.store_id
`;

/**
 * Every privilege-plan activation members have submitted — `app.wallet_card`
 * joined to its member, tier and branch. Pending first, then newest.
 */
export async function listActivations(): Promise<PrivilegeActivation[]> {
  const rows = await query<Row>(
    `SELECT ${ACTIVATION_COLUMNS}
     ORDER BY
       CASE wc.status WHEN 'PENDING' THEN 0 WHEN 'ON_HOLD' THEN 1 ELSE 2 END,
       wc.submitted_at DESC`,
  );
  return rows.map(toActivation);
}

/** A single activation by `app.wallet_card.id`, for the review page. */
export async function getActivation(
  id: string,
): Promise<PrivilegeActivation | null> {
  const rows = await query<Row>(
    `SELECT ${ACTIVATION_COLUMNS} WHERE wc.id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? toActivation(rows[0]) : null;
}

/**
 * Every privilege plan one member has activated (`app.wallet.member_id`),
 * newest first — the cards shown on their user page and member-plans page.
 */
export async function listActivationsForMember(
  memberId: string,
): Promise<PrivilegeActivation[]> {
  const rows = await query<Row>(
    `SELECT ${ACTIVATION_COLUMNS}
     WHERE w.member_id = $1
     ORDER BY
       CASE wc.status WHEN 'PENDING' THEN 0 WHEN 'ON_HOLD' THEN 1 ELSE 2 END,
       wc.submitted_at DESC`,
    [memberId],
  );
  return rows.map(toActivation);
}

/**
 * A member's wallet at a glance — balance and reward points, looked up from
 * the wallet card being reviewed. Lets a reviewer see what the plan will
 * land on top of. Deliberately just these two figures: the review screen
 * shows what is there, never the member's transaction history.
 */
export async function getWalletActivity(
  walletCardId: string,
): Promise<WalletActivity> {
  const walletRows = (await sql`
    SELECT w.balance, w.reward_points
    FROM app.wallet_card wc
    JOIN app.wallet w ON w.id = wc.wallet_id
    WHERE wc.id = ${walletCardId}
  `) as Row[];

  const w = walletRows[0] ?? {};
  return {
    balance: num(w.balance),
    rewardPoints: num(w.reward_points),
  };
}

/**
 * Saves the reviewer's own verification checklist for a pending (or
 * on-hold) activation — the UTR they read off their own bank statement, when
 * they saw the transfer land, whether the uploaded receipt image checks out,
 * and what they saw credited. Separate from, and never overwriting, what the
 * member submitted (`receiptReference`, `receiptFileName`, `receiptImage`).
 *
 * Purely an audit record: it never touches status, the wallet, or any
 * commission logic — only [approveActivation] does that, and only once this
 * checklist is complete (see `ActivationDetailPage`'s own doc). A no-op —
 * and returns `false` — once the card is already decided, so a stray save
 * after someone else has approved or rejected it cannot silently succeed.
 */
export async function saveActivationVerification(
  id: string,
  input: {
    verifiedReference: string;
    receivedOn: string; // '' clears it
    receiptVerified: boolean;
    receivedAmount: number | null;
  },
): Promise<boolean> {
  const rows = await query<Row>(
    `
    UPDATE app.wallet_card
       SET verified_reference = $2,
           received_on = $3::date,
           receipt_verified = $4,
           received_amount = $5
     WHERE id = $1 AND status IN ('PENDING', 'ON_HOLD')
     RETURNING id
    `,
    [
      id,
      input.verifiedReference.trim() || null,
      input.receivedOn || null,
      input.receiptVerified,
      input.receivedAmount,
    ],
  );
  return rows.length > 0;
}

/**
 * Approves a pending (or on-hold) activation in one call: flips the card to
 * `APPROVED`, writes the `ACTIVATION` + `BONUS` ledger lines, credits the
 * wallet balance (load + bonus), stamps `opened_at`, records the sale as
 * `app.agent_customer_plan` when this member was registered under an
 * agent's code (what the agent portal's "Direct sale" / "Team sales"
 * figures are worked out from), and splits the Health Pass commission pool
 * between the direct-selling agent, the one national agent, and the
 * company's own reserved share.
 *
 * That whole write is now `app.approve_wallet_card_activation` (migration
 * 0033), a single Postgres function rather than the multi-CTE statement this
 * used to be inline: this driver is one HTTP call per statement with no
 * cross-statement transaction, and the commission split's own conditional
 * branching (who sold it, whether they're the national agent, whether a
 * national agent exists at all) doesn't fit that shape cleanly enough to
 * trust as a correlated-subquery CTE chain for something crediting real
 * money. See that function's own doc for the split itself.
 *
 * A no-op — and returns `false` — if the card is already decided (or a
 * stale id), or if the reviewer's own verification checklist
 * ([saveActivationVerification]) is not yet complete: real money moves here,
 * so this is checked again before the call rather than trusted from the
 * console's own disabled button alone. Deliberately a separate query before
 * the one below, not a `WHERE` wrapped around it — `approve_wallet_card_activation`
 * writes the ledger and credits the balance as a side effect of being
 * *called*, so gating on the result of the same call would still credit the
 * money even on a row the gate then filtered out.
 */
export async function approveActivation(id: string): Promise<boolean> {
  const [ready] = await query<Row>(
    `
    SELECT 1 FROM app.wallet_card
     WHERE id = $1
       AND status IN ('PENDING', 'ON_HOLD')
       AND coalesce(btrim(verified_reference), '') <> ''
       AND received_on IS NOT NULL
       AND receipt_verified
       AND received_amount IS NOT NULL
    `,
    [id],
  );
  if (!ready) {
    return false;
  }
  const rows = await query<Row>(
    `SELECT * FROM app.approve_wallet_card_activation($1)`,
    [id],
  );
  return rows.length > 0;
}

/**
 * Rejects a pending (or on-hold) activation with a reason the member sees in
 * their wallet. Nothing is credited. Returns `false` if the card was already
 * decided.
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
     WHERE id = $1 AND status IN ('PENDING', 'ON_HOLD')
     RETURNING id
    `,
    [id, trimmed],
  );
  return rows.length > 0;
}

/**
 * Neither approves nor rejects — parks a pending activation with a note (the
 * member sees it in their wallet, same as a rejection reason) so a reviewer
 * who needs more from the member before deciding has somewhere to put that
 * down, distinct from silently leaving it untouched in the pending queue.
 * Still fully reversible: [approveActivation] / [rejectActivation] both
 * accept an `ON_HOLD` card the same as a `PENDING` one. Returns `false` if
 * the card was not `PENDING` (already decided, or already on hold).
 */
export async function holdActivation(
  id: string,
  note: string,
): Promise<boolean> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error('Give the member a reason it is on hold.');
  const rows = await query<Row>(
    `
    UPDATE app.wallet_card
       SET status = 'ON_HOLD', reviewer_note = $2, reviewed_at = now()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING id
    `,
    [id, trimmed],
  );
  return rows.length > 0;
}
