import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/format';
import { cashPendingOf, receiveHeading } from '@/lib/billCash';
import type { Order } from '@/types';

const HEADING_TONE: Record<ReturnType<typeof receiveHeading>, Tone> = {
  Completed: 'green',
  'Partially billed': 'violet',
  Pending: 'amber',
};

type Method = 'gpay' | 'cash';

/**
 * The Receive panel for one priced bill: its status at the top, and the
 * payment method at the bottom — GPay, Cash, or both, each with an amount
 * the counter types in. Display-level for now: nothing typed here is written
 * to the bill, and no UPI payment is initiated or verified.
 */
export function ReceivePaymentModal({
  order,
  open,
  onClose,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
}) {
  const total = order.billAmount;
  const [chosen, setChosen] = useState<Set<Method>>(new Set());
  const [amounts, setAmounts] = useState<Record<Method, string>>({ gpay: '', cash: '' });

  const heading = receiveHeading(order);
  const entered = (['gpay', 'cash'] as Method[])
    .filter((m) => chosen.has(m))
    .reduce((sum, m) => sum + (Number(amounts[m]) || 0), 0);
  const remaining = Math.max(total - entered, 0);
  const owedInCash = cashPendingOf(order);

  function toggle(method: Method) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(method)) {
        next.delete(method);
      } else {
        next.add(method);
        // A lone method starts with the whole amount still owed, so the
        // counter only has to change it when the split is not even.
        if (next.size === 1) {
          setAmounts((a) => ({ ...a, [method]: String(total) }));
        }
      }
      return next;
    });
  }

  function setAmount(method: Method, value: string) {
    setAmounts((a) => ({ ...a, [method]: value.replace(/[^0-9.]/g, '') }));
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
            <p className="font-medium text-slate-800">{formatCurrency(total)}</p>
          </div>
          <div>
            <p className="text-slate-500">Still owed in cash</p>
            <p className="font-medium text-slate-800">{formatCurrency(owedInCash)}</p>
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
        </div>

        <p className="text-xs text-slate-400">
          Shown here for the counter's own record. Amounts typed here are not
          written to the bill yet.
        </p>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
