import type { Order } from '@/types';

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

/**
 * Where this order's bill stands by comparing what's supposed to be on it
 * (`billableItemNames`) against what is actually on it (`billLines`):
 *   - 'pending':  nothing's been billed yet.
 *   - 'billed':   every billable item is on the bill (or there's no known
 *     billable set to compare against — a manually-built bill still counts
 *     as done rather than perpetually "partial").
 *   - 'partial':  something's been billed, but not everything that should be.
 */
export function billProgress(row: Order): 'pending' | 'partial' | 'billed' {
  const billed = new Set(
    row.billLines.map((l) => l.name.trim().toLowerCase()).filter(Boolean),
  );
  if (billed.size === 0) return 'pending';
  const billable = row.billableItemNames
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  if (billable.length === 0) return 'billed';
  return billable.every((n) => billed.has(n)) ? 'billed' : 'partial';
}

/** The three words the Receive panel's header uses: Completed once the bill
 *  is settled, Partially billed while only some of its items are on it, and
 *  Pending otherwise. */
export function receiveHeading(row: Order): 'Completed' | 'Partially billed' | 'Pending' {
  if (row.billStatus === 'paid') return 'Completed';
  if (billProgress(row) === 'partial') return 'Partially billed';
  return 'Pending';
}

/** Whether one item on an order counts as selected for its bill — the same
 *  rule the server uses for `billableItemNames`, and what the bill editor
 *  offers and seeds from:
 *   - a standard order's own line: only one marked "Stock available";
 *   - a prescription's intake medicine: anything not marked "Not possible"
 *     (what the intake card's checkbox ticks). */
export function isSelectedForBill(kind: Order['kind'], status: string): boolean {
  return kind === 'prescription' ? status !== 'not_possible' : status === 'available';
}
