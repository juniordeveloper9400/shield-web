import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/format';
import { cashPendingOf, receiveHeading } from '@/lib/billCash';
import { useAuth } from '@/context/AuthContext';
import { receiveBillPayment } from '@/api/billPayments';
import type { Order } from '@/types';

const HEADING_TONE: Record<ReturnType<typeof receiveHeading>, Tone> = {
  Completed: 'green',
  'Partially billed': 'violet',
  Pending: 'amber',
};

type Method = 'gpay' | 'cash';

/** Whole rupees and paise as typed — anything else is dropped as it's entered. */
function parseAmount(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The Receive panel for one priced bill — the Manual cash "closing" step.
 * The counter picks GPay, cash, or both and types what arrived; "Record
 * payment" writes it to the bill (`PATCH /v1/staff/orders/:id/receive`). The
 * server refuses anything above what is still owed, and marks the bill PAID
 * once it is covered. Nothing is written until that call succeeds.
 */
export function ReceivePaymentModal({
  order,
  open,
  onClose,
  onSaved,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
  /** Called after a payment is recorded, so the list can refresh. `settled`
   *  is true when it covered everything still owed; `remaining` is what is
   *  left otherwise. */
  onSaved: (result: { settled: boolean; remaining: number }) => void;
}) {
  const { accessToken } = useAuth();
  const owed = cashPendingOf(order);
  const [chosen, setChosen] = useState<Set<Method>>(new Set());
  const [amounts, setAmounts] = useState<Record<Method, string>>({ gpay: '', cash: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heading = receiveHeading(order);
  const gpay = chosen.has('gpay') ? parseAmount(amounts.gpay) : 0;
  const cash = chosen.has('cash') ? parseAmount(amounts.cash) : 0;
  const entered = gpay + cash;
  const remaining = Math.max(owed - entered, 0);
  const overBy = entered > owed;
  const canSave = entered > 0 && !overBy && !saving;

  function toggle(method: Method) {
    setError(null);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(method)) {
        next.delete(method);
      } else {
        next.add(method);
        // A lone method starts with everything still owed, so the counter only
        // changes it when the split is not even.
        if (next.size === 1) {
          setAmounts((a) => ({ ...a, [method]: String(owed) }));
        }
      }
      return next;
    });
  }

  function setAmount(method: Method, value: string) {
    setError(null);
    setAmounts((a) => ({ ...a, [method]: value.replace(/[^0-9.]/g, '') }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await receiveBillPayment(order.id, { cash, gpay }, accessToken);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onSaved({ settled: result.settled, remaining: Number(result.remaining) });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Receive · ${order.code}`} size="md">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Bill status</span>
          <Badge tone={HEADING_TONE[heading]}>{heading}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div>
            <p className="text-slate-500">Bill total</p>
            <p className="font-medium text-slate-800">{formatCurrency(order.billAmount)}</p>
          </div>
          <div>
            <p className="text-slate-500">Still owed</p>
            <p className="font-medium text-slate-800">{formatCurrency(owed)}</p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Payment method</p>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { key: 'gpay', label: 'GPay' },
                { key: 'cash', label: 'Cash' },
              ] as { key: Method; label: string }[]
            ).map(({ key, label }) => {
              const on = chosen.has(key);
              return (
                <div
                  key={key}
                  className={`rounded-lg border p-3 ${on ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    aria-pressed={on}
                    className="flex w-full items-center justify-between text-sm font-medium text-slate-800"
                  >
                    {label}
                    <span
                      className={`h-4 w-4 rounded border ${on ? 'border-brand-600 bg-brand-600' : 'border-slate-300'}`}
                    />
                  </button>
                  {on && (
                    <label className="mt-3 block text-xs text-slate-500">
                      Amount
                      <input
                        inputMode="decimal"
                        value={amounts[key]}
                        onChange={(e) => setAmount(key, e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
                        placeholder="0"
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {chosen.size > 0 && (
            <p className="mt-3 text-sm text-slate-600">
              Entered <span className="font-medium">{formatCurrency(entered)}</span> ·
              remaining <span className="font-medium">{formatCurrency(remaining)}</span>
            </p>
          )}
          {overBy && (
            <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              That is more than the {formatCurrency(owed)} still owed.
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}

        <p className="text-xs text-slate-400">
          Recorded against the bill when you press Record payment. The bill is
          marked paid once everything owed has been received.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            {saving ? 'Recording…' : 'Record payment'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
