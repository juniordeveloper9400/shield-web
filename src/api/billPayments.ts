import { query } from '@/lib/db';

type Row = Record<string, unknown>;

/**
 * Settles a sent-and-priced bill off the member's wallet, staff-triggered —
 * the collection half of `BillEditorModal`'s OTP flow: the member reads the
 * code Firebase texted them out to staff, staff verifies it client-side
 * (`confirmDeliveryOtp`), and only on that success does this get called.
 *
 * One statement, same atomic-CTE shape `activations.ts`'s `approveActivation`
 * uses — debits `app.wallet.balance`, posts the matching `SPEND` ledger
 * line, and marks both the order and its bill PAID, all together or not at
 * all. The `eligible` CTE is the whole guard: a bill that's already paid,
 * unpriced, or a wallet that can't cover it makes the row set empty and
 * nothing downstream writes — mirrors `order.service.ts`'s
 * `debitWalletForOrder` guard on the backend/api side of this same
 * operation, which this console does not call (shieldweb writes to Neon
 * directly, same as every other money-moving action here).
 */
export async function collectBillWithWallet(
  orderId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rows = await query<Row>(
    `
    WITH eligible AS (
      SELECT o.id AS order_id, o.code, b.id AS bill_id, b.amount, w.id AS wallet_id
        FROM app."order" o
        JOIN app.bill b ON b.order_id = o.id
        JOIN app.wallet w ON w.member_id = o.member_id
       WHERE o.id = $1
         AND b.status = 'PENDING'::app.order_payment_status
         AND b.amount > 0
         AND w.balance >= b.amount
    ),
    debit AS (
      UPDATE app.wallet w
         SET balance = w.balance - (SELECT amount FROM eligible),
             updated_at = now()
       WHERE w.id = (SELECT wallet_id FROM eligible)
       RETURNING w.id
    ),
    ledger AS (
      INSERT INTO app.wallet_entry (wallet_id, kind, label, amount, occurred_on, order_id)
      SELECT wallet_id, 'SPEND'::app.wallet_entry_kind, 'Order ' || code, -amount, current_date, order_id
        FROM eligible
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
         SET status = 'PAID'::app.order_payment_status, paid_at = now(), updated_at = now()
       WHERE b.id = (SELECT bill_id FROM eligible)
      RETURNING 1
    )
    SELECT order_id FROM eligible
    `,
    [orderId],
  );

  if (rows.length > 0) {
    return { ok: true };
  }

  // Nothing written — work out why, so staff sees a real reason instead of a
  // silent no-op.
  const diagnosis = await query<Row>(
    `
    SELECT b.status::text AS bill_status, b.amount AS bill_amount, w.balance AS wallet_balance
      FROM app."order" o
      LEFT JOIN app.bill b ON b.order_id = o.id
      LEFT JOIN app.wallet w ON w.member_id = o.member_id
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
  if (d.wallet_balance == null) {
    return { ok: false, reason: "This member hasn't opened a wallet yet." };
  }
  return {
    ok: false,
    reason: `Wallet balance (₹${Number(d.wallet_balance)}) is short of the bill (₹${Number(d.bill_amount)}).`,
  };
}
