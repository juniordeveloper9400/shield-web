import type { MoneyFlowEntry } from '@/types';

/** One {@link MoneyFlowEntry}, plus the running balance right after it —
 *  what actually makes a transaction list read as a ledger (Debit / Credit
 *  / Balance) instead of just a list of amounts. Shared by the user detail
 *  page's own "Transaction ledger" tab and the Accounts page's per-member
 *  ledger report, so the two can never disagree about a balance. */
export interface LedgerRow extends MoneyFlowEntry {
  balance: number;
}

/**
 * [entries] (any order) turned into a ledger: the running balance is worked
 * out chronologically — oldest first, since a balance at a given moment is
 * a historical fact, not something a later re-sort or filter should be able
 * to change — then handed back newest-first, the order every ledger screen
 * in this console actually displays.
 */
export function buildLedger(entries: MoneyFlowEntry[]): LedgerRow[] {
  const chronological = [...entries].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );
  let balance = 0;
  const withBalance = chronological.map((row) => {
    balance += row.direction === 'in' ? row.amount : -row.amount;
    return { ...row, balance };
  });
  return withBalance.reverse();
}
