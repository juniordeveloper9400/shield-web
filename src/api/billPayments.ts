import { query } from '@/lib/db';
import { num } from '@/lib/mappers';

type Row = Record<string, unknown>;

/**
 * Settles a sent-and-priced bill, staff-triggered — the collection half of
 * `BillEditorModal`'s (and `PrescriptionReviewModal`'s Bill step's) OTP
 * flow: the member reads the code Firebase texted them out to staff, staff
 * verifies it client-side (`confirmDeliveryOtp`), and only on that success
 * does this get called.
 *
 * Draws on the member's wallet first — up to whatever it actually holds,
 * never more — and treats anything still owed after that as collected in
 * cash at the counter, in this same action (migration 0041's
 * `wallet_collected` / `cash_collected` columns are exactly this split,
 * kept for the record). A wallet with nothing in it collects the bill
 * entirely in cash; a wallet that covers it in full collects entirely from
 * the wallet, same as this function's own previous, wallet-only behaviour.
 * Either way the bill is marked PAID the moment this returns `ok`, since
 * the cash portion (if any) is handed over in person at the same moment the
 * admin clicks this — there is no "pay the cash part later" state.
 *
 * One statement, same atomic-CTE shape `activations.ts`'s `approveActivation`
 * uses — debits `app.wallet.balance` by only the wallet's share, posts the
 * matching `SPEND` ledger line for that share, and marks both the order and
 * its bill PAID, all together or not at all. The `eligible` CTE is the
 * whole guard: a bill that's already paid or unpriced makes the row set
 * empty and nothing downstream writes.
 */
export async function collectBillWithWallet(
  orderId: string,
): Promise<
  { ok: true; walletAmount: number; cashAmount: number } | { ok: false; reason: string }
> {
  const rows = await query<Row>(
    `
    WITH eligible AS (
      SELECT o.id AS order_id, o.code, b.id AS bill_id, b.amount,
             w.id AS wallet_id, COALESCE(w.balance, 0) AS wallet_balance,
             LEAST(COALESCE(w.balance, 0), b.amount) AS wallet_amount,
             b.amount - LEAST(COALESCE(w.balance, 0), b.amount) AS cash_amount
        FROM app."order" o
        JOIN app.bill b ON b.order_id = o.id
        LEFT JOIN app.wallet w ON w.member_id = o.member_id
       WHERE o.id = $1
         AND b.status = 'PENDING'::app.order_payment_status
         AND b.amount > 0
    ),
    debit AS (
      UPDATE app.wallet w
         SET balance = w.balance - (SELECT wallet_amount FROM eligible),
             updated_at = now()
       WHERE w.id = (SELECT wallet_id FROM eligible)
         AND (SELECT wallet_amount FROM eligible) > 0
       RETURNING w.id
    ),
    ledger AS (
      INSERT INTO app.wallet_entry (wallet_id, kind, label, amount, occurred_on, order_id)
      SELECT wallet_id, 'SPEND'::app.wallet_entry_kind, 'Order ' || code, -wallet_amount, current_date, order_id
        FROM eligible
       WHERE wallet_amount > 0
      RETURNING 1
    ),
    mark_order AS (
      UPDATE app."order" o
         SET payment_status = 'PAID'::app.order_payment_status, paid_at = now(), updated_at = now()
       WHERE o.id = (SELECT order_id FROM eligible)
      RETURNING 1
    ),
    mark_bill AS (
      UPDATE app.bill b
         SET status = 'PAID'::app.order_payment_status, paid_at = now(), updated_at = now(),
             wallet_collected = (SELECT wallet_amount FROM eligible),
             cash_collected = (SELECT cash_amount FROM eligible)
       WHERE b.id = (SELECT bill_id FROM eligible)
      RETURNING 1
    )
    SELECT order_id, wallet_amount, cash_amount FROM eligible
    `,
    [orderId],
  );

  if (rows.length > 0) {
    return {
      ok: true,
      walletAmount: num(rows[0].wallet_amount),
      cashAmount: num(rows[0].cash_amount),
    };
  }

  // Nothing written — work out why, so staff sees a real reason instead of a
  // silent no-op.
  const diagnosis = await query<Row>(
    `
    SELECT b.status::text AS bill_status, b.amount AS bill_amount
      FROM app."order" o
      LEFT JOIN app.bill b ON b.order_id = o.id
     WHERE o.id = $1
    `,
    [orderId],
  );
  const d = diagnosis[0];
  if (!d || d.bill_status == null) {
    return { ok: false, reason: 'No bill has been sent for this order yet.' };
  }
  if (d.bill_status === 'paid') {
    return { ok: false, reason: 'This bill is already paid.' };
  }
  if (Number(d.bill_amount ?? 0) <= 0) {
    return { ok: false, reason: 'This bill has not been priced yet.' };
  }
  return { ok: false, reason: 'Could not collect this bill — try again.' };
}
