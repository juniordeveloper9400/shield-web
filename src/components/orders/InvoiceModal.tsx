import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { completeBilledOrder } from '@/api/orders';
import { formatDateTime } from '@/lib/format';
import { buildInvoice, canCompleteInvoice, downloadInvoice, invoiceWhatsAppUrl, formatInvoiceCurrency as formatCurrency, type Invoice } from '@/lib/invoice';
import type { Order, Store } from '@/types';

function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  return (
    <article className="invoice-document bg-white text-slate-800">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold">SHIELD Pharmacy</h2>
          <p className="text-sm font-semibold">{invoice.storeName}</p>
          <p className="max-w-sm text-xs text-slate-500">{invoice.storeAddress}</p>
          {invoice.storePhone && <p className="text-xs text-slate-500">Phone: {invoice.storePhone}</p>}
        </div>
        <div className="text-right">
          <h2 className="text-xl font-bold">INVOICE</h2>
          <p className="text-sm">{invoice.code}</p>
          <p className="text-xs text-slate-500">{formatDateTime(invoice.date)}</p>
          <p className="mt-2 text-xs font-semibold">Order: {invoice.orderStatus}</p>
          <p className="text-xs">Payment: {invoice.paymentStatus === 'paid' ? 'Paid' : 'Pending'}</p>
        </div>
      </header>
      <div className="my-4 grid grid-cols-2 gap-4 text-sm">
        <div><p className="text-xs uppercase text-slate-500">Billed to</p>
          <p className="font-semibold">{invoice.customer}</p><p>{invoice.phone}</p></div>
        <div className="text-right"><p className="text-xs uppercase text-slate-500">Fulfilment</p>
          <p>{invoice.fulfillment}</p></div>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500"><tr>
          <th className="p-2 text-left">Item</th><th className="p-2 text-right">Qty</th>
          <th className="p-2 text-right">Unit price</th><th className="p-2 text-right">Amount</th>
        </tr></thead>
        <tbody>{invoice.rows.map((row, index) => <tr key={index} className="border-b border-slate-100">
          <td className="p-2"><p>{row.name}</p>{row.pack && <p className="text-xs text-slate-500">{row.pack}</p>}</td>
          <td className="p-2 text-right">{row.qty}</td><td className="p-2 text-right whitespace-nowrap">{formatCurrency(row.unitPrice)}</td>
          <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(row.amount)}</td>
        </tr>)}</tbody>
      </table>
      {!invoice.rows.length && <p className="py-4 text-sm text-slate-500">No itemized lines were recorded for this bill.</p>}
      <div className="invoice-totals ml-auto mt-4 max-w-xs space-y-2 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
        {!!invoice.deliveryFee && <div className="flex justify-between"><span>Delivery fee</span><span>{formatCurrency(invoice.deliveryFee)}</span></div>}
        {!!invoice.adjustment && <div className="flex justify-between"><span>Bill adjustment</span><span>{formatCurrency(invoice.adjustment)}</span></div>}
        <div className="flex justify-between border-t pt-2 text-lg font-bold"><span>Total</span><span>{formatCurrency(invoice.total)}</span></div>
      </div>
      <p className="mt-6 border-t pt-3 text-center text-xs text-slate-500">Thank you for choosing SHIELD Pharmacy.</p>
    </article>
  );
}

export function InvoiceModal({ order, store, open, onClose, onCompleted }: {
  order: Order; store: Store | undefined; open: boolean; onClose: () => void;
  onCompleted?: () => void;
}) {
  const [completedId, setCompletedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const completing = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdf, setPdf] = useState<{ key: string; file: File } | null>(null);
  const currentOrder = useMemo(() => completedId === order.id ? { ...order, status: 'delivered' as const } : order, [order, completedId]);
  const invoice = useMemo(() => buildInvoice(currentOrder, store), [currentOrder, store]);
  const key = JSON.stringify(invoice);
  const canExport = currentOrder.status === 'delivered' && currentOrder.billAmount > 0;
  const file = pdf?.key === key ? pdf.file : null;

  useEffect(() => {
    if (!open || !canExport) return;
    let active = true;
    setError(null);
    // Prepare before Share is clicked, preserving the required user gesture.
    import('@/lib/invoicePdf').then(({ createInvoicePdf }) => createInvoicePdf(invoice))
      .then((file) => { if (active) setPdf({ key, file }); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Could not create PDF. You can still print the invoice.'); });
    return () => { active = false; };
  }, [open, canExport, key]);

  async function complete() {
    if (completing.current || !canCompleteInvoice(currentOrder)) return;
    completing.current = true; setBusy(true); setError(null);
    try {
      await completeBilledOrder(order.id);
      setCompletedId(order.id);
      onCompleted?.();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not complete the order.'); }
    finally { completing.current = false; setBusy(false); }
  }

  async function share() {
    if (!file) return;
    setError(null); setNotice(null);
    if (!navigator.canShare?.({ files: [file] }) || !navigator.share) {
      downloadInvoice(file);
      setNotice('Invoice PDF downloaded. Attach it in WhatsApp, email, or another app.');
      return;
    }
    try { await navigator.share({ files: [file], title: `SHIELD invoice ${invoice.code}` }); }
    catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Sharing was unavailable. Download the PDF and attach it in your preferred app.');
    }
  }

  function whatsapp() {
    if (!file) return;
    setError(null);
    try {
      const url = invoiceWhatsAppUrl(invoice);
      window.open(url, '_blank', 'noopener,noreferrer');
      downloadInvoice(file);
      setNotice('WhatsApp opened for the customer. Attach the downloaded invoice PDF before sending.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open WhatsApp.'); }
  }

  return <>
    <Modal open={open} onClose={onClose} title={`Invoice — ${order.code}`} size="lg" footer={<>
      <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      {canCompleteInvoice(currentOrder) && <Button size="sm" variant="success" disabled={busy} onClick={() => void complete()}>{busy ? 'Completing…' : 'Complete order'}</Button>}
      {canExport && <>
        <Button size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
        <Button size="sm" disabled={!file} onClick={() => file && downloadInvoice(file)}>{file ? 'Download PDF' : 'Preparing PDF…'}</Button>
        <Button size="sm" variant="secondary" disabled={!file} onClick={() => void share()}>Share PDF</Button>
        <Button size="sm" variant="success" disabled={!file} onClick={whatsapp}>WhatsApp customer</Button>
      </>}
    </>}>
      {!canExport && <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">{currentOrder.status === 'cancelled' ? 'This order is cancelled.' : currentOrder.billAmount <= 0 ? 'Save a priced bill before completing this order.' : 'Complete the order to print, download, or share this invoice. Payment status is recorded separately.'}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-rose-600">{error}</p>}
      {notice && <p role="status" className="mb-3 text-sm text-brand-700">{notice}</p>}
      <InvoiceDocument invoice={invoice} />
    </Modal>
    {open && canExport && createPortal(<div className="invoice-print-root"><InvoiceDocument invoice={invoice} /></div>, document.body)}
  </>;
}
