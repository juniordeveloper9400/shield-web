/**
 * A member's Health Pass "this month" figures, worked out the same way the
 * member's own wallet screen does (`WalletService.redeemedThisMonth` /
 * `monthlyBalance` in the Flutter app), so an admin collecting a bill sees
 * exactly what the member sees. No imports on purpose — it is pure, and tested
 * on its own.
 */

/** One row of `app.wallet_entry`, reduced to what the month figures need. */
export interface LedgerEntry {
  /** `app.wallet_entry_kind`, e.g. `SPEND`, `AGENT_EARNINGS`. */
  kind: string;
  /** Credits positive, debits negative — the ledger's own sign. */
  amount: number;
  /** `YYYY-MM-DD` — the day the entry is dated (`occurred_on`). */
  occurredOn: string;
}

/** Commission the member earned: spendable at any time, outside the monthly allowance. */
function isEarnings(entry: LedgerEntry): boolean {
  return entry.kind === 'REFERRAL_EARNINGS' || entry.kind === 'AGENT_EARNINGS';
}

/**
 * How much of this calendar month's allowance has been drawn: every debit dated
 * in the month of [now], less the part of it paid out of the member's earned
 * commission (which is theirs to spend whenever, so it never counts against the
 * allowance).
 *
 * [entriesOldestFirst] must be in the order they happened — earnings are
 * spent first, and what "was left" depends on the sequence.
 */
export function redeemedThisMonth(entriesOldestFirst: LedgerEntry[], now: Date): number {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let earnings = 0;
  let total = 0;
  for (const entry of entriesOldestFirst) {
    if (isEarnings(entry) && entry.amount > 0) {
      earnings += entry.amount;
    }
    const earningsSpent = entry.amount < 0 ? Math.min(earnings, -entry.amount) : 0;
    earnings -= earningsSpent;
    if (entry.amount < 0 && isInMonth(entry.occurredOn, year, month)) {
      total += -entry.amount - earningsSpent;
    }
  }
  return total;
}

/**
 * What is left of this month's allowance. Floored at zero: an allowance that
 * has been used up is used up, and a negative one would read as a debt the
 * member does not owe.
 */
export function monthlyBalanceOf(monthlyRedeemable: number, redeemed: number): number {
  return Math.max(0, monthlyRedeemable - redeemed);
}

function isInMonth(isoDate: string, year: number, month: number): boolean {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(isoDate);
  return match !== null && Number(match[1]) === year && Number(match[2]) === month;
}
