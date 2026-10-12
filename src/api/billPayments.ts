import { api } from '@/lib/api';
import { num } from '@/lib/mappers';

type Row = Record<string, unknown>;

/**
 * The four Health Pass figures `BillEditorModal` shows before a reviewer
 * commits to collecting a bill — balance, what's actually drawable right
 * now (capped at this month's allowance, same as `collectBillWithWallet`
 * would draw), the month's whole allowance, and what it has already drawn
 * this month. One call (`GET /v1/staff/orders/:id/wallet-preview`,
 * `OrderService.getWalletPreview`) rather than four separate direct-SQL
 * reads, now that the figures themselves live on the backend.
 */
async function getWalletPreview(orderId: string, token: string | null) {
  return api.get<Row>(`/v1/staff/orders/${orderId}/wallet-preview`, token);
}

export async function getAvailableAllowanceForOrder(orderId: string, token: string | null): Promise<number> {
  return num((await getWalletPreview(orderId, token)).availableAllowance);
}

/**
 * The wallet balance of whichever member placed [orderId], read-only — `0`
 * for a member with no wallet row at all (never activated one). Lets
 * `BillEditorModal` show what collecting a given total would actually draw
 * from the wallet, and what's left over for cash, before the reviewer
 * commits to anything.
 */
export async function getWalletBalanceForOrder(orderId: string, token: string | null): Promise<number> {
  return num((await getWalletPreview(orderId, token)).balance);
}

/**
 * "Health Pass monthly redeemable": everything the member's wallet has
 * released so far across every approved card — carry-forward from earlier
 * months included — less whatever plan spending happened before this month
 * began.
 *
 * Informational only: this does NOT change what `collectBillWithWallet`
 * actually draws (the full balance, same as it always has) — a member's
 * whole balance is genuinely spendable the moment it lands, the same as
 * every other write path in this app treats it. This figure exists purely
 * so a reviewer collecting a bill can see the Health Pass allowance
 * alongside the real balance before deciding how to collect, not to gate
 * the collection itself.
 */
export async function getMonthlyRedeemableForOrder(orderId: string, token: string | null): Promise<number> {
  return num((await getWalletPreview(orderId, token)).monthlyRedeemable);
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
 * The bill is marked PAID here only when the wallet covered all of it
 * (`settled`). Anything the wallet could not cover comes back as `cashAmount`
 * — still owed, NOT assumed collected — and the bill stays unpaid until the
 * counter records it through [receiveBillPayment] (the Manual cash Receive
 * panel), or it waits on the Manual cash list.
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
/**
 * Records money the counter takes against a priced bill — GPay and/or cash,
 * as it arrives (`PATCH /v1/staff/orders/:id/receive`, migration 0071). The
 * server refuses an amount above what is still owed, and marks the bill PAID
 * once it is covered; nothing here is written until that call succeeds.
 */
export async function receiveBillPayment(
  orderId: string,
  amounts: { cash: number; gpay: number },
  token: string | null,
): Promise<{ ok: true; settled: boolean; remaining: string } | { ok: false; reason: string }> {
  return api.patch(`/v1/staff/orders/${orderId}/receive`, amounts, token);
}

export async function collectBillWithWallet(
  orderId: string,
  token: string | null,
): Promise<
  | { ok: true; walletAmount: number; cashAmount: number; settled: boolean }
  | { ok: false; reason: string }
> {
  return api.patch(`/v1/staff/orders/${orderId}/collect-wallet`, undefined, token);
}

/**
 * How much of this month's Health Pass allowance the member of [orderId] has
 * already drawn — the "Redeemed this month" line on their own wallet card.
 * `0` for a member with no wallet or nothing drawn yet.
 *
 * Together with [getMonthlyRedeemableForOrder] this gives the "Monthly
 * balance" — what is left this month — shown when collecting a bill.
 */
export async function getRedeemedThisMonthForOrder(orderId: string, token: string | null): Promise<number> {
  return num((await getWalletPreview(orderId, token)).redeemedThisMonth);
}
