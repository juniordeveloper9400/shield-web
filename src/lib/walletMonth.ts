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

export interface AllowanceCard { loaded: number; issuedOn: string }

/** Unused releases remain available; future instalments never release early. */
export function availablePlanAllowance(cards: AllowanceCard[], entriesOldestFirst: LedgerEntry[], now: Date, balance: number): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let released = 0;
  for (const card of cards) {
    const [year, month, day] = card.issuedOn.slice(0, 10).split('-').map(Number);
    const issued = new Date(year, month - 1, day);
    if (!Number.isFinite(issued.getTime()) || today < issued) continue;
    const dueDay = Math.min(day, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
    const instalments = Math.max(0, Math.min(12,
      (today.getFullYear() - year) * 12 + today.getMonth() - (month - 1) + 1 - (today.getDate() < dueDay ? 1 : 0)));
    released += Math.floor(card.loaded / 12) * instalments;
  }
  let earnings = 0;
  let spent = 0;
  const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  for (const entry of entriesOldestFirst) {
    if (entry.occurredOn.slice(0, 10) > isoToday) continue;
    if (isEarnings(entry) && entry.amount > 0) earnings += entry.amount;
    if (entry.amount < 0) {
      const fromEarnings = Math.min(earnings, -entry.amount);
      earnings -= fromEarnings;
      spent += -entry.amount - fromEarnings;
    }
  }
  return Math.max(0, Math.min(balance, released - spent));
}

function isInMonth(isoDate: string, year: number, month: number): boolean {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(isoDate);
  return match !== null && Number(match[1]) === year && Number(match[2]) === month;
}
