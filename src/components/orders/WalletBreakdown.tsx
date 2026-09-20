import type { ReactNode } from 'react';
import { monthlyBalanceOf } from '@/lib/walletMonth';

/**
 * What the member's wallet looks like against the bill on screen: their
 * balance, this month's Health Pass allowance the way their own wallet card
 * shows it (redeemable, redeemed, and what's left), and what collecting the
 * total would actually draw from the wallet versus take in cash.
 *
 * Shared by both places `BillEditorModal` shows it — while pricing the bill and
 * while collecting it — so the two can never disagree.
 *
 * The month figures are informational, as they always have been here: what a
 * collection draws is still the wallet balance itself (see
 * `collectBillWithWallet`), not the monthly balance.
 */
export function WalletBreakdown({
  walletBalance,
  monthlyRedeemable,
  redeemedThisMonth,
  walletShare,
  walletShareLabel,
  cashOwed,
  format,
}: {
  walletBalance: number;
  /** Null/undefined until loaded — the month block only shows once both figures are in. */
  monthlyRedeemable: number | null | undefined;
  redeemedThisMonth: number | null | undefined;
  walletShare: number;
  /** "From wallet" while pricing, "Will draw from wallet" while collecting. */
  walletShareLabel: string;
  cashOwed: number;
  format: (amount: number) => string;
}) {
  // A member with no Health Pass card and nothing drawn has no monthly
  // allowance to speak of — same rule as the app, which only shows it once a
  // wallet is open.
  const hasMonth =
    monthlyRedeemable != null &&
    redeemedThisMonth != null &&
    (monthlyRedeemable > 0 || redeemedThisMonth > 0);
  const monthlyBalance = hasMonth
    ? monthlyBalanceOf(monthlyRedeemable, redeemedThisMonth)
    : 0;

  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <Row label="Member's wallet balance" value={format(walletBalance)} />
      {hasMonth && (
        <div className="my-1.5 space-y-1 border-y border-slate-200 py-1.5">
          <Row label="Health Pass monthly redeemable" value={format(monthlyRedeemable)} />
          <Row label="Redeemed this month" value={format(redeemedThisMonth)} />
          <Row
            label="Monthly balance"
            value={format(monthlyBalance)}
            emphasis={monthlyBalance > 0 ? 'good' : 'muted'}
          />
        </div>
      )}
      <Row label={walletShareLabel} value={format(walletShare)} className="mt-1" />
      <Row
        label={cashOwed > 0 ? 'Collect in cash, hand to hand' : 'Cash needed'}
        value={format(cashOwed)}
        emphasis={cashOwed > 0 ? 'warn' : undefined}
        className="mt-1"
      />
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  className = '',
}: {
  label: string;
  value: ReactNode;
  emphasis?: 'good' | 'warn' | 'muted';
  className?: string;
}) {
  const valueClass =
    emphasis === 'warn'
      ? 'font-semibold text-amber-700'
      : emphasis === 'good'
        ? 'font-semibold text-emerald-700'
        : emphasis === 'muted'
          ? 'font-semibold text-slate-500'
          : 'font-medium text-slate-800';
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <span>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}
