import { query } from '@/lib/db';
import { api } from '@/lib/api';
import { num } from '@/lib/mappers';
import { redeemedThisMonth } from '@/lib/walletMonth';

type Row = Record<string, unknown>;

/**
 * The wallet balance of whichever member placed [orderId], read-only — `0`
 * for a member with no wallet row at all (never activated one), same as
 * `collectBillWithWallet`'s own `COALESCE(w.balance, 0)` treats it, and the
 * same join it uses (`app."order" → app.wallet` on `member_id`) rather than
 * needing the member's id on hand separately. Lets `BillEditorModal` show
 * what collecting a given total would actually draw from the wallet, and
 * what's left over for cash, before the reviewer commits to anything — the
 * same `LEAST(balance, amount)` split `collectBillWithWallet` performs,
 * worked out here ahead of time against whatever total is on screen right
 * now rather than what's saved on `app.bill` yet.
 */
export async function getWalletBalanceForOrder(orderId: string): Promise<number> {
  const rows = await query<Row>(
    `SELECT COALESCE(w.balance, 0) AS balance
       FROM app."order" o
       LEFT JOIN app.wallet w ON w.member_id = o.member_id
      WHERE o.id = $1`,
    [orderId],
  );
  return rows.length > 0 ? num(rows[0].balance) : 0;
}

/**
 * What the member's Health Pass wallet actually releases this month, across
 * every approved card — the same "a twelfth of what's on the card, on the
 * day of the month it was issued" rule `WalletCard.monthlyRedeemable` /
 * `isActiveOn` apply in the Flutter app (`lib/module/wallet/wallet_service.dart`),
 * ported here since it is never persisted as a column — `app.wallet.balance`
 * carries a card's full load the moment it's approved (see
 * `approve_wallet_card_activation`), not released in instalments.
 *
 * Informational only: this does NOT change what `collectBillWithWallet`
 * actually draws (the full balance, same as it always has) — a member's
 * whole balance is genuinely spendable the moment it lands, the same as
 * every other write path in this app treats it. This figure exists purely
 * so a reviewer collecting a bill can see the Health Pass allowance
 * alongside the real balance before deciding how to collect, not to gate
 * the collection itself.
 */
export async function getMonthlyRedeemableForOrder(orderId: string): Promise<number> {
  const rows = await query<Row>(
    `WITH cards AS (
       SELECT wc.amount + wc.bonus + wc.recharged_extra AS loaded,
              wc.issued_on, wc.expires_on
         FROM app."order" o
         JOIN app.wallet w      ON w.member_id = o.member_id
         JOIN app.wallet_card wc ON wc.wallet_id = w.id AND wc.status = 'APPROVED'
        WHERE o.id = $1
     )
     SELECT COALESCE(SUM(FLOOR(loaded / 12)), 0) AS total
       FROM cards
      WHERE current_date >= issued_on
        AND current_date <= expires_on
        AND EXTRACT(day FROM current_date) >= LEAST(
              EXTRACT(day FROM issued_on),
              EXTRACT(day FROM (date_trunc('month', current_date) + interval '1 month - 1 day'))
            )`,
    [orderId],
  );
  return rows.length > 0 ? num(rows[0].total) : 0;
}

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
 * Now `PATCH /v1/staff/orders/:id/collect-wallet`
 * (`OrderService.collectBillWithWallet`, backend/api) — a Drizzle
 * transaction there, not a raw multi-CTE statement here, but the exact same
 * logic: a bill that's already paid or unpriced is refused with the same
 * three reasons, checked before the transaction opens rather than gating on
 * its result (see backend/docs/migration-plan.md Phase 1). The three read
 * helpers above stay on direct Neon for now — only the write that actually
 * moves money is migrated in this slice.
 */
export async function collectBillWithWallet(
  orderId: string,
  token: string | null,
): Promise<
  { ok: true; walletAmount: number; cashAmount: number } | { ok: false; reason: string }
> {
  return api.patch(`/v1/staff/orders/${orderId}/collect-wallet`, undefined, token);
}

/**
 * How much of this month's Health Pass allowance the member of [orderId] has
 * already drawn — the "Redeemed this month" line on their own wallet card.
 * Read from the ledger (`app.wallet_entry`, oldest first) and worked out by the
 * same rule the app uses; see `redeemedThisMonth` in `lib/walletMonth.ts`.
 * `0` for a member with no wallet or nothing drawn yet.
 *
 * Together with [getMonthlyRedeemableForOrder] this gives the "Monthly
 * balance" — what is left this month — shown when collecting a bill.
 */
export async function getRedeemedThisMonthForOrder(orderId: string): Promise<number> {
  const rows = await query<Row>(
    `SELECT we.kind::text AS kind, we.amount, we.occurred_on::text AS occurred_on
       FROM app."order" o
       JOIN app.wallet w         ON w.member_id = o.member_id
       JOIN app.wallet_entry we  ON we.wallet_id = w.id
      WHERE o.id = $1
      ORDER BY we.created_at ASC, we.id ASC`,
    [orderId],
  );
  return redeemedThisMonth(
    rows.map((r) => ({
      kind: String(r.kind),
      amount: num(r.amount),
      occurredOn: String(r.occurred_on),
    })),
    new Date(),
  );
}
