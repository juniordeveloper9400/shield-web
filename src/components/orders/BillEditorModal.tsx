import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatInvoiceCurrency as formatCurrency } from '@/lib/invoice';
import { fileToResizedDataUrl } from '@/lib/images';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/context/AuthContext';
import { completeBilledOrder, sendOrderInvoice } from '@/api/orders';
import {
  collectBillWithWallet,
  getMonthlyRedeemableForOrder,
  getAvailableAllowanceForOrder,
  getRedeemedThisMonthForOrder,
  getWalletBalanceForOrder,
} from '@/api/billPayments';
import { getPrescriptionMedicinesForOrder } from '@/api/prescriptions';
import { listStores } from '@/api/stores';
import { clearDeliveryOtp, confirmDeliveryOtp, describeOtpError, sendDeliveryOtp } from '@/lib/deliveryOtp';
import {
  STOCK_STATUS_LABEL,
  STOCK_STATUS_TONE,
} from '@/lib/prescriptionMedicine';
import { ORDER_LINE_STATUS_LABEL, ORDER_LINE_STATUS_TONE } from '@/lib/orderLineStatus';
import { InvoiceModal } from './InvoiceModal';
import { WalletBreakdown } from './WalletBreakdown';
import type { Tone } from '@/components/ui/Badge';
import type { Order, PaymentStatus } from '@/types';

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

interface BillLineDraft {
  name: string;
  pack: string;
  unitPrice: number;
  qty: number;
}

/**
 * The one priced-invoice builder for any order — standard or prescription —
 * shared by `BillsPage` and `OrdersPage` rather than each growing its own
 * copy. Pre-fills from the order's own cart lines for a standard order (the
 * price is already known at checkout time); a prescription order has none of
 * those, so its own intake medicines (see `getPrescriptionMedicinesForOrder`)
 * are offered below as one-tap "Add to bill" candidates, grouped by the same
 * stock status the intake card set — an admin choosing what actually goes on
 * the bill rather than retyping every line from the script by hand. Also
 * where "Convert to bill →" on `PrescriptionReviewModal` now lands.
 */
export function BillEditorModal({
  order,
  open,
  onClose,
  onSaved,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const hasBill = order.billAmount > 0;
  const [mode, setMode] = useState<'summary' | 'edit'>(hasBill ? 'summary' : 'edit');
  // 'edit' mode is itself two steps: 'select' — a full-page checkbox table
  // of every candidate item (the order's own cart lines, plus a
  // prescription's intake medicines), Rate shown read-only since nothing's
  // priced yet — then 'price', the existing per-line Name/Pack/Rate/Qty
  // form, once "Proceed →" carries the checked items forward. Reopening an
  // already-sent bill ("Edit bill") skips straight to 'price' — its
  // composition was already decided the first time; a "← Items" link gets
  // back to 'select' if it needs to change.
  const [editStep, setEditStep] = useState<'select' | 'price'>(hasBill ? 'price' : 'select');
  // Whether a priced bill exists at all — true from a previous visit
  // (`hasBill`) or the moment `submit()` sends one in this session. Once
  // true, the summary below reads the bill from this component's own
  // `lines`/`total` state rather than the `order` prop, which the parent
  // has no reason to have refreshed yet (the modal stays open straight
  // through sending → collecting → viewing the invoice, all one visit).
  const [billSent, setBillSent] = useState(hasBill);
  const [savedBill, setSavedBill] = useState({ amount: order.billAmount, lines: order.billLines });
  const [showInvoice, setShowInvoice] = useState(false);
  const [completed, setCompleted] = useState(order.status === 'delivered');
  const [billedAt, setBilledAt] = useState(order.billedAt);
  const completingRequest = useRef(false);
  // "Complete order" — the order's own tracked status (`Order placed →
  // Store will contact → Billed → Completed`, see the member app's own
  // `OrderTrack`) now moves on this click rather than a separate raw
  // status button: once the bill is paid, this is what actually closes
  // the order out. Explicit and admin-driven, never automatic — a paid
  // bill alone doesn't mean the order has actually gone out.
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // For the invoice's letterhead — resolved by the order's own branch code
  // rather than passed in, so this modal (shared by BillsPage and
  // OrdersPage) doesn't need a store prop threaded through both call sites.
  const { accessToken } = useAuth();
  const { data: stores } = useAsync(() => listStores(accessToken), [accessToken]);
  const store = stores?.find((s) => s.code === order.storeCode);

  // This order's own intake medicines, when it has any (a prescription
  // order only) — the picker below offers them by stock status instead of
  // making the admin retype the script from scratch.
  const { data: prescriptionMedicines } = useAsync(
    () =>
      order.kind === 'prescription'
        ? getPrescriptionMedicinesForOrder(order.id)
        : Promise.resolve(null),
    [order.id, order.kind],
  );

  // What collecting the total on screen right now would actually draw from
  // the wallet, and what's left for cash — the same `LEAST(balance, amount)`
  // split `collectBillWithWallet` performs, shown ahead of time so the
  // admin knows what to expect before ever sending the OTP.
  const { data: walletBalance } = useAsync(
    () => getWalletBalanceForOrder(order.id),
    [order.id],
  );

  // Informational only — see `getMonthlyRedeemableForOrder`'s own doc for
  // why this never factors into `walletCoverage`/`cashOwed` below: the
  // Health Pass "monthly allowance" is a member-facing display idea, not a
  // real ceiling on the balance itself, which is fully spendable the
  // moment it lands.
  const { data: availableAllowance } = useAsync(() => getAvailableAllowanceForOrder(order.id), [order.id]);
  const { data: monthlyRedeemable } = useAsync(
    () => getMonthlyRedeemableForOrder(order.id),
    [order.id],
  );

  // How much of that allowance the member has already drawn this month — with
  // it, the "Monthly balance" (what's left) the member sees on their own
  // wallet card. Same informational status as the line above.
  const { data: redeemedThisMonth } = useAsync(
    () => getRedeemedThisMonthForOrder(order.id),
    [order.id],
  );

  // --- OTP-gated wallet collection ----------------------------------------
  // Nothing here ever debits the wallet on its own — sendOtp only asks
  // Firebase to text the member a code; verifyAndCollect is the one place
  // that calls collectBillWithWallet, and only after Firebase has confirmed
  // the code staff typed in actually matches what was sent to the member's
  // phone. See lib/deliveryOtp.ts.
  const [otpConfirmation, setOtpConfirmation] = useState<ConfirmationResult | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [collected, setCollected] = useState<{ walletAmount: number; cashAmount: number } | null>(
    null,
  );
  const recaptchaContainerId = `bill-otp-recaptcha-${order.id}`;
  const otpInFlight = useRef(false);
  const otpSession = useRef(0);

  useEffect(() => {
    return () => {
      otpSession.current += 1;
      clearDeliveryOtp(recaptchaContainerId);
    };
  }, [recaptchaContainerId, open]);

  async function sendOtp() {
    // Defense in depth alongside the buttons' own `disabled={otpBusy}`: a
    // click that lands before React has repainted that attribute must not
    // start a second verifier against the same container while the first
    // is still rendering.
    if (otpInFlight.current) return;
    otpInFlight.current = true;
    const session = otpSession.current;
    setOtpBusy(true);
    setOtpError(null);
    setOtpConfirmation(null);
    setOtpCode('');
    try {
      const confirmation = await sendDeliveryOtp(order.memberPhone, recaptchaContainerId);
      if (session !== otpSession.current) return;
      setOtpConfirmation(confirmation);
    } catch (err) {
      if (session !== otpSession.current) return;
      setOtpError(describeOtpError(err));
    } finally {
      otpInFlight.current = false;
      setOtpBusy(false);
    }
  }

  async function verifyAndCollect() {
    if (otpInFlight.current || !otpConfirmation || !/^\d{6}$/.test(otpCode.trim())) return;
    otpInFlight.current = true;
    const session = otpSession.current;
    setOtpBusy(true);
    setOtpError(null);
    try {
      await confirmDeliveryOtp(otpConfirmation, otpCode);
      if (session !== otpSession.current) return;
      // Firebase codes are single-use. A collection retry needs a fresh code.
      setOtpConfirmation(null);
      setOtpCode('');
      const result = await collectBillWithWallet(order.id, accessToken);
      if (!result.ok) {
        setOtpError(result.reason);
        return;
      }
      setCollected({ walletAmount: result.walletAmount, cashAmount: result.cashAmount });
      setOtpConfirmation(null);
      setOtpCode('');
      onSaved();
    } catch (err) {
      setOtpError(describeOtpError(err));
    } finally {
      otpInFlight.current = false;
      setOtpBusy(false);
    }
  }
  const [lines, setLines] = useState<BillLineDraft[]>(() =>
    order.billLines.length > 0
      ? order.billLines
      : // Only lines the counter marked "Stock available" start on the bill —
        // out-of-stock, not-possible and customer-not-needed lines are left off
        // (an admin can still add one back by hand with "+ Add line").
        order.lines
          .filter((l) => l.status === 'available')
          .map((l) => ({
            name: l.name,
            pack: l.pack,
            unitPrice: l.unitPrice,
            qty: l.qty,
          })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usableLines = useMemo(
    () => lines.filter((l) => l.name.trim() && l.unitPrice > 0 && l.qty > 0),
    [lines],
  );
  const total = useMemo(
    () => usableLines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0),
    [usableLines],
  );
  const collectionAmount = billSent && mode === 'summary' ? savedBill.amount : total;
  const walletCoverage = Math.min(walletBalance ?? 0, collectionAmount);
  const cashOwed = Math.max(collectionAmount - walletCoverage, 0);

  // The bill as it actually stands right now — `total`/`usableLines` once
  // one has been sent in this session or an earlier one (`billSent`),
  // falling back to the order prop only for an order that has never been
  // billed at all. `collected` (set the moment `verifyAndCollect` succeeds)
  // is what flips this to paid without waiting on a parent reload.
  const effectiveBillAmount = savedBill.amount;
  const effectiveBillLines = savedBill.lines;
  // `app.bill.status` (`order.billStatus`) and `app.order.payment_status`
  // (`order.paymentStatus`) are two independently-tracked "is this paid"
  // facts, and only one of them is guaranteed to exist yet: a standard
  // order paid in full by wallet at checkout (`order.service.ts`'s own
  // `checkout`) is `paymentStatus: 'paid'` the moment it's placed, well
  // before any bill has ever been sent for it — `billStatus` only starts
  // existing once a bill row does, defaulting PENDING regardless. Without
  // this, sending a bill for an order like that would still show the
  // "Collect bill" OTP section and ask staff to take payment a second time
  // for money the member already paid at checkout. `collected` (this
  // session's own confirmation) and `order.paymentStatus` both independently
  // being able to say "paid" is exactly what closes that gap.
  const effectiveBillStatus: PaymentStatus =
    collected || order.paymentStatus === 'paid' ? 'paid' : order.billStatus;

  function patchLine(i: number, patch: Partial<BillLineDraft>) {
    setLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeLine(i: number) {
    setLines((rows) => rows.filter((_, idx) => idx !== i));
  }

  const addedNames = useMemo(
    () => new Set(lines.map((l) => l.name.trim().toLowerCase())),
    [lines],
  );

  interface CandidateRow {
    name: string;
    pack: string;
    qty: number;
    /** Read-only here — the actual price gets typed in on the 'price' step. */
    rate: number;
    statusLabel: string;
    statusTone: Tone;
    included: boolean;
  }

  const linesByName = useMemo(() => {
    const m = new Map<string, BillLineDraft>();
    for (const l of lines) m.set(l.name.trim().toLowerCase(), l);
    return m;
  }, [lines]);

  // Every item the admin could put on this bill, from both places one
  // might come from — the order's own reviewed cart lines (a standard
  // order's own prices already live here from checkout) and, for a
  // prescription order, its intake medicines not already one of those
  // lines. A line added by hand, or one already on a previously-sent
  // bill, that matches neither source still has to show up so unchecking
  // it stays possible. `lines` itself (not a separate selection flag) is
  // what "included" means, same single source of truth `submit()` sends.
  const candidateRows: CandidateRow[] = useMemo(() => {
    const rows = new Map<string, CandidateRow>();
    const keyOf = (n: string) => n.trim().toLowerCase();

    for (const l of order.lines) {
      const key = keyOf(l.name);
      if (!key || rows.has(key)) continue;
      const draft = linesByName.get(key);
      rows.set(key, {
        name: l.name,
        pack: l.pack,
        qty: draft ? draft.qty : l.qty,
        rate: draft ? draft.unitPrice : l.unitPrice,
        statusLabel: ORDER_LINE_STATUS_LABEL[l.status],
        statusTone: ORDER_LINE_STATUS_TONE[l.status],
        included: Boolean(draft),
      });
    }
    for (const m of prescriptionMedicines ?? []) {
      const key = keyOf(m.name);
      if (!key || rows.has(key)) continue;
      const draft = linesByName.get(key);
      rows.set(key, {
        name: m.name,
        pack: m.pack,
        qty: draft ? draft.qty : m.totalUnits || 1,
        rate: draft ? draft.unitPrice : 0,
        statusLabel: STOCK_STATUS_LABEL[m.status],
        statusTone: STOCK_STATUS_TONE[m.status],
        included: Boolean(draft),
      });
    }
    for (const l of lines) {
      const key = keyOf(l.name);
      if (!key || rows.has(key)) continue;
      rows.set(key, {
        name: l.name,
        pack: l.pack,
        qty: l.qty,
        rate: l.unitPrice,
        statusLabel: 'Added manually',
        statusTone: 'gray',
        included: true,
      });
    }
    return [...rows.values()];
  }, [order.lines, prescriptionMedicines, lines, linesByName]);

  const includedCount = candidateRows.filter((r) => r.included).length;

  function toggleCandidate(row: CandidateRow) {
    const key = row.name.trim().toLowerCase();
    if (row.included) {
      setLines((rows) => rows.filter((r) => r.name.trim().toLowerCase() !== key));
    } else {
      setLines((rows) => [...rows, { name: row.name, pack: row.pack, unitPrice: row.rate, qty: row.qty || 1 }]);
    }
  }

  function setAllCandidates(selected: boolean) {
    if (!selected) {
      setLines([]);
      return;
    }
    setLines((rows) => {
      const have = new Set(rows.map((r) => r.name.trim().toLowerCase()));
      const additions = candidateRows
        .filter((r) => !have.has(r.name.trim().toLowerCase()))
        .map((r) => ({ name: r.name, pack: r.pack, unitPrice: r.rate, qty: r.qty || 1 }));
      return [...rows, ...additions];
    });
  }

  async function attachImage(file: File) {
    setError(null);
    try {
      const image = await fileToResizedDataUrl(file, 1400, 0.78);
      setSaving(true);
      await sendOrderInvoice(order.id, { image, amount: total, lines: usableLines });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach the invoice.');
    } finally {
      setSaving(false);
    }
  }

  /** Sends the priced bill and stays open, switching to the summary — the
   *  admin's own next moves (collecting payment, then viewing/printing the
   *  invoice) both happen right here in the same visit, rather than closing
   *  and needing "Manage bill" reopened to reach them. */
  async function submit() {
    if (usableLines.length === 0) {
      setError('Add at least one priced line before sending.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sentAt = await sendOrderInvoice(order.id, { amount: total, lines: usableLines });
      setBilledAt(sentAt);
      setSavedBill({ amount: total, lines: usableLines.map(line => ({ ...line })) });
      onSaved();
      setBillSent(true);
      setMode('summary');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this bill.');
    } finally {
      setSaving(false);
    }
  }

  /** Complete fulfilment without altering the bill's actual payment status. */
  async function completeOrder() {
    if (completingRequest.current) return;
    completingRequest.current = true;
    setCompleting(true);
    setCompleteError(null);
    try {
      await completeBilledOrder(order.id);
      setCompleted(true);
      onSaved();
      setShowInvoice(true);
    } catch (err) {
      setCompleteError(
        err instanceof Error ? err.message : 'Could not complete this order.',
      );
    } finally {
      completingRequest.current = false;
      setCompleting(false);
    }
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={`${order.code} — invoice`}
      size="full"
      footer={
        mode === 'edit' ? (
          editStep === 'select' ? (
            <>
              <Button variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={includedCount === 0}
                title={includedCount === 0 ? 'Check at least one item first' : undefined}
                onClick={() => setEditStep('price')}
              >
                Proceed →
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditStep('select')} disabled={saving}>
                ← Items
              </Button>
              <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void submit()} disabled={saving}>
                {billSent ? 'Resend bill' : 'Send bill'}
              </Button>
            </>
          )
        ) : (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <p className="mb-3 text-xs text-slate-400">
        {order.memberName} · {order.memberPhone}
      </p>

      {mode === 'summary' ? (
        <div className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm text-slate-800">
            Bill sent — {formatCurrency(effectiveBillAmount)} (
            {effectiveBillStatus === 'paid' ? 'Paid' : 'Pending'})
          </p>
          {effectiveBillLines.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
              {effectiveBillLines.map((l, i) => (
                <li key={i}>
                  {l.name} {l.pack && `(${l.pack})`} × {l.qty} — {formatCurrency(l.unitPrice * l.qty)}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={completed || completing}
              onClick={() => {
                setMode('edit');
                setEditStep('price');
              }}
            >
              Edit bill
            </Button>
            {order.billImage && (
              <a
                href={order.billImage}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-brand-600"
              >
                View attached picture
              </a>
            )}
          </div>
        </div>
      ) : null}

      {mode === 'summary' && billSent && effectiveBillAmount > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 p-4">
          {collected ? (
            <p className="text-sm font-medium text-emerald-600">
              Collected —{' '}
              {collected.walletAmount > 0 && `${formatCurrency(collected.walletAmount)} from wallet`}
              {collected.walletAmount > 0 && collected.cashAmount > 0 && ' + '}
              {collected.cashAmount > 0 && `${formatCurrency(collected.cashAmount)} in cash`}
              . This bill is paid.
            </p>
          ) : effectiveBillStatus === 'paid' ? (
            <p className="text-sm font-medium text-emerald-600">This bill is paid.</p>
          ) : (
            <p className="text-sm text-amber-700">Payment pending. Completing the order does not collect payment.</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {completed ? (
              <>
                <span className="text-xs font-medium text-emerald-700">Order completed</span>
                <Button size="sm" onClick={() => setShowInvoice(true)}>Print / share invoice</Button>
              </>
            ) : order.status === 'cancelled' ? (
              <span className="text-xs font-medium text-slate-500">Order cancelled</span>
            ) : (
              <Button
                variant="success"
                size="sm"
                disabled={completing}
                onClick={() => void completeOrder()}
              >
                {completing ? 'Completing…' : 'Complete order'}
              </Button>
            )}
          </div>
          {completeError && (
            <p className="mt-2 text-xs text-rose-600">{completeError}</p>
          )}
        </div>
      )}

      {mode === 'summary' && effectiveBillStatus !== 'paid' && (
        <div className="mt-3 rounded-lg border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Collect bill
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Send a one-time code to the member's phone, then enter what they read out to
            you. Only once that code checks out: the member's wallet balance is used
            automatically (up to the bill amount), and any shortfall is collected in cash
            at the counter — never before the code is verified.
          </p>
          <div className="mt-3">
            <WalletBreakdown
              walletBalance={walletBalance ?? 0}
              monthlyRedeemable={monthlyRedeemable}
              redeemedThisMonth={redeemedThisMonth} availableAllowance={availableAllowance}
              walletShare={walletCoverage}
              walletShareLabel="Will draw from wallet"
              cashOwed={cashOwed}
              format={formatCurrency}
            />
          </div>
          <div id={recaptchaContainerId} />
          {!otpConfirmation ? (
            <Button
              size="sm"
              className="mt-3"
              disabled={otpBusy}
              onClick={() => void sendOtp()}
            >
              {otpBusy ? 'Sending…' : 'Send OTP to member'}
            </Button>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <input
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="6-digit code"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                autoFocus
                className={inputClass}
              />
              <Button
                size="sm"
                disabled={otpBusy || !/^\d{6}$/.test(otpCode.trim())}
                onClick={() => void verifyAndCollect()}
              >
                {otpBusy ? 'Verifying…' : 'Verify & collect'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={otpBusy}
                onClick={() => void sendOtp()}
              >
                Resend
              </Button>
            </div>
          )}
          {otpError && <p className="mt-2 text-xs text-rose-600">{otpError}</p>}
        </div>
      )}

      {mode === 'edit' && editStep === 'select' && (
        <div>
          <p className="mb-1 text-sm font-semibold text-slate-800">Choose what's on this bill</p>
          <p className="mb-3 text-xs text-slate-400">
            Check every item that belongs on this invoice — from the order's own reviewed
            cart lines{order.kind === 'prescription' ? " and the prescription's intake medicines" : ''}.
            Rate is shown for reference only here; it and quantity become editable on the next step.
          </p>
          <div className="overflow-x-auto overflow-y-visible rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      title={includedCount === candidateRows.length ? 'Clear all' : 'Select all'}
                      checked={candidateRows.length > 0 && includedCount === candidateRows.length}
                      ref={(el) => {
                        if (!el) return;
                        el.indeterminate = includedCount > 0 && includedCount < candidateRows.length;
                      }}
                      onChange={(e) => setAllCandidates(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                  </th>
                  <th className="px-3 py-2">Product name</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Rate</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {candidateRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      Nothing to bill yet — this order has no reviewed cart lines or intake
                      medicines.
                    </td>
                  </tr>
                ) : (
                  candidateRows.map((row) => (
                    <tr key={row.name.trim().toLowerCase()} className="align-top">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={row.included}
                          onChange={() => toggleCandidate(row)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-700">{row.name}</span>
                        {row.pack && <span className="text-slate-400"> · {row.pack}</span>}
                      </td>
                      <td className="px-3 py-2">{row.qty || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {row.rate > 0 ? formatCurrency(row.rate) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'edit' && editStep === 'price' && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Bill lines
            </p>
            <button
              type="button"
              className="text-xs font-medium text-brand-600"
              onClick={() =>
                setLines((rows) => [...rows, { name: '', pack: '', unitPrice: 0, qty: 1 }])
              }
            >
              + Add line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Line {i + 1}</span>
                  <button
                    type="button"
                    className="text-xs font-medium text-rose-600 hover:text-rose-700"
                    onClick={() => removeLine(i)}
                  >
                    Remove
                  </button>
                </div>
                <input
                  value={line.name}
                  onChange={(e) => patchLine(i, { name: e.target.value })}
                  placeholder="Item name"
                  className={inputClass}
                />
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <input
                    value={line.pack}
                    onChange={(e) => patchLine(i, { pack: e.target.value })}
                    placeholder="Pack"
                    className={inputClass}
                  />
                  <input
                    value={line.unitPrice || ''}
                    onChange={(e) => patchLine(i, { unitPrice: Number(e.target.value) || 0 })}
                    placeholder="Unit price"
                    inputMode="decimal"
                    className={inputClass}
                  />
                  <input
                    value={line.qty || ''}
                    onChange={(e) => patchLine(i, { qty: Number(e.target.value) || 0 })}
                    placeholder="Qty"
                    inputMode="numeric"
                    className={inputClass}
                  />
                </div>
              </div>
            ))}
            {lines.length === 0 && (
              <p className="text-sm text-slate-400">No lines yet — add at least one.</p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-800">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>
          {total > 0 && (
            <div className="mt-2">
              <WalletBreakdown
                walletBalance={walletBalance ?? 0}
                monthlyRedeemable={monthlyRedeemable}
                redeemedThisMonth={redeemedThisMonth} availableAllowance={availableAllowance}
                walletShare={walletCoverage}
                walletShareLabel="From wallet"
                cashOwed={cashOwed}
                format={formatCurrency}
              />
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <label className="cursor-pointer text-xs font-medium text-brand-600">
              {order.billImage ? 'Replace attached picture' : 'Attach a picture instead'}
              <input
                type="file"
                accept="image/*"
                disabled={saving}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void attachImage(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </Modal>
    <InvoiceModal
      order={{
        ...order,
        billAmount: effectiveBillAmount,
        billLines: effectiveBillLines,
        billStatus: effectiveBillStatus,
        billedAt,
        status: completed ? 'delivered' : order.status,
      }}
      store={store}
      open={showInvoice}
      onClose={() => setShowInvoice(false)}
      onCompleted={() => { setCompleted(true); onSaved(); }}
    />
    </>
  );
}
