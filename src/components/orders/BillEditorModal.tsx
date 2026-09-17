import { useMemo, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/format';
import { fileToResizedDataUrl } from '@/lib/images';
import { sendOrderInvoice } from '@/api/orders';
import { collectBillWithWallet } from '@/api/billPayments';
import { confirmDeliveryOtp, describeOtpError, sendDeliveryOtp } from '@/lib/deliveryOtp';
import type { Order } from '@/types';

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
 * those, so it opens empty for the admin to key in from the intake card —
 * the same shape `PrescriptionReviewModal`'s own bill step writes through
 * `sendOrderInvoice`.
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

  async function sendOtp() {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const confirmation = await sendDeliveryOtp(order.memberPhone, recaptchaContainerId);
      setOtpConfirmation(confirmation);
    } catch (err) {
      setOtpError(describeOtpError(err));
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyAndCollect() {
    if (!otpConfirmation || otpCode.trim().length === 0) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      await confirmDeliveryOtp(otpConfirmation, otpCode);
      const result = await collectBillWithWallet(order.id);
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
      setOtpBusy(false);
    }
  }
  const [lines, setLines] = useState<BillLineDraft[]>(() =>
    order.billLines.length > 0
      ? order.billLines
      : order.lines.map((l) => ({
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

  function patchLine(i: number, patch: Partial<BillLineDraft>) {
    setLines((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeLine(i: number) {
    setLines((rows) => rows.filter((_, idx) => idx !== i));
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

  async function submit() {
    if (usableLines.length === 0) {
      setError('Add at least one priced line before sending.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sendOrderInvoice(order.id, { amount: total, lines: usableLines });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this bill.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${order.code} — invoice`}
      footer={
        mode === 'edit' ? (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={saving}>
              {hasBill ? 'Resend bill' : 'Send bill'}
            </Button>
          </>
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
            Bill sent — {formatCurrency(order.billAmount)} (
            {order.billStatus === 'paid' ? 'Paid' : 'Pending'})
          </p>
          {order.billLines.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
              {order.billLines.map((l, i) => (
                <li key={i}>
                  {l.name} {l.pack && `(${l.pack})`} × {l.qty} — {formatCurrency(l.unitPrice * l.qty)}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setMode('edit')}>
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

      {mode === 'summary' && order.billStatus !== 'paid' && (
        <div className="mt-3 rounded-lg border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Collect bill
          </p>
          {collected ? (
            <p className="mt-2 text-sm font-medium text-emerald-600">
              Collected —{' '}
              {collected.walletAmount > 0 && `${formatCurrency(collected.walletAmount)} from wallet`}
              {collected.walletAmount > 0 && collected.cashAmount > 0 && ' + '}
              {collected.cashAmount > 0 && `${formatCurrency(collected.cashAmount)} in cash`}
              . This bill is paid.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-500">
                Send a one-time code to the member's phone, then enter what they read out to
                you. Only once that code checks out: the member's wallet balance is used
                automatically (up to the bill amount), and any shortfall is collected in cash
                at the counter — never before the code is verified.
              </p>
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
                    autoFocus
                    className={inputClass}
                  />
                  <Button
                    size="sm"
                    disabled={otpBusy || otpCode.trim().length === 0}
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
            </>
          )}
        </div>
      )}

      {mode === 'edit' && (
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
  );
}
