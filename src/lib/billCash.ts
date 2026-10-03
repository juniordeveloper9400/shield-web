/** What's still owed in cash on a priced bill — the figure the Manual cash
 *  report shows as "Cash pending". The bill's own amount is already net of
 *  its discount; what the member's wallet covered and what the counter has
 *  taken so far come off it, floored at zero so an overpayment never reads
 *  as negative cash. A bill not yet collected (both zero) owes the full
 *  amount in cash. */
export function cashPendingOf(bill: {
  billAmount: number;
  billWalletCollected: number;
  billCashCollected: number;
}): number {
  return Math.max(bill.billAmount - bill.billWalletCollected - bill.billCashCollected, 0);
}
