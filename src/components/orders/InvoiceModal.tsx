import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDateTime, titleCase } from '@/lib/format';
import type { BillLine, Order, OrderLine, Store } from '@/types';

/** Common shape between a priced `BillLine` and a plain `OrderLine`. */
interface InvoiceRow {
  name: string;
  pack: string;
  unitPrice: number;
  qty: number;
}

/**
 * A standard, printable invoice for one order — what "click a row on Bills"
 * opens now, in place of nothing (a row click did nothing before this) or
 * the raw uploaded photo alone.
 *
 * Line items come from `order.billLines` when the store has priced one
 * (always true for a prescription, which has no price until intake) and
 * fall back to the order's own `lines` otherwise — a standard order is
 * priced from the catalogue at checkout, so there is always a real
 * itemised breakdown to show even before anyone has "sent a bill" for it.
 * A photo attached the simple way (`sendOrderBill`, no priced lines) is
 * shown underneath as supporting documentation rather than in place of the
 * table.
 */
export function InvoiceModal({
  order,
  store,
  open,
  onClose,
}: {
  order: Order;
  store: Store | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const pricedLines: (BillLine | OrderLine)[] =
    order.billLines.length > 0 ? order.billLines : order.lines;
  const rows: InvoiceRow[] = pricedLines.map((l) => ({
    name: l.name,
    pack: l.pack,
    unitPrice: l.unitPrice,
    qty: l.qty,
  }));
  const subtotal = rows.reduce((sum, r) => sum + r.unitPrice * r.qty, 0);
  const usingBilledAmount = order.billLines.length > 0 && order.billAmount > 0;
  const total = usingBilledAmount ? order.billAmount : order.paidTotal || subtotal;
  const invoiceDate = order.billedAt || order.placedAt;
  const status = usingBilledAmount ? order.billStatus : order.paymentStatus;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Invoice — ${order.code}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </>
      }
    >
      <div id="invoice-print-area" className="bg-white text-slate-800">
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-4">
          <div>
            <p className="text-lg font-bold text-slate-900">SHIELD Pharmacy</p>
            <p className="text-sm text-slate-600">{store?.name ?? order.storeName}</p>
            {store && (
              <p className="text-xs text-slate-500">
                {[store.area, store.city, store.state, store.pincode]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            )}
            {store?.phone && <p className="text-xs text-slate-500">Phone: {store.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xl font-bold uppercase tracking-wide text-slate-900">
              Invoice
            </p>
            <p className="mt-1 text-sm text-slate-600">{order.code}</p>
            <p className="text-xs text-slate-500">{formatDateTime(invoiceDate)}</p>
            <div className="mt-2">
              <Badge tone={status === 'paid' ? 'green' : 'amber'}>{titleCase(status)}</Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-b border-slate-200 py-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Billed to
            </p>
            <p className="mt-1 text-sm font-medium text-slate-800">{order.memberName}</p>
            <p className="text-xs text-slate-500">{order.memberPhone}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fulfilment
            </p>
            <p className="mt-1 text-sm font-medium text-slate-800">
              {titleCase(order.fulfillmentType)}
            </p>
            <p className="text-xs text-slate-500">
              {order.paymentMethod || 'Payment method not recorded'}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                    No line items recorded for this order.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <p className="text-slate-800">{row.name}</p>
                      {row.pack && <p className="text-xs text-slate-400">{row.pack}</p>}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{row.qty}</td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      {formatCurrency(row.unitPrice)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-800">
                      {formatCurrency(row.unitPrice * row.qty)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-4 w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex items-center justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {order.deliveryFee > 0 && (
            <div className="flex items-center justify-between text-slate-600">
              <span>Delivery fee</span>
              <span>{formatCurrency(order.deliveryFee)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-slate-900">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>
        </div>

        {order.billImage && (
          <div className="mt-6 border-t border-slate-200 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Attached invoice photo
            </p>
            <img
              src={order.billImage}
              alt="Invoice sent to the member"
              className="max-h-96 w-full rounded-lg border border-slate-200 object-contain"
            />
          </div>
        )}

        <p className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-400">
          Thank you for choosing SHIELD Pharmacy.
        </p>
      </div>
    </Modal>
  );
}
