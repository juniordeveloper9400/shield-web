import type { Order, Store } from '../types';

const money = (value: number) => Math.round(value * 100) / 100;

export function formatInvoiceCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

export function canCompleteInvoice(order: Order): boolean {
  return order.billAmount > 0 && order.status !== 'cancelled' && order.status !== 'delivered';
}

/** Saved invoice values are authoritative; payment and fulfilment are separate. */
export function buildInvoice(order: Order, store?: Store) {
  const rows = (order.billLines.length ? order.billLines : order.lines).map((line) => ({
    ...line, amount: money(line.unitPrice * line.qty),
  }));
  const subtotal = money(rows.reduce((sum, row) => sum + row.amount, 0));
  const total = money(order.billAmount > 0 ? order.billAmount : order.paidTotal || subtotal + order.deliveryFee);
  // The current bill editor saves the full payable amount. Only show a separate
  // delivery charge if it actually reconciles to that amount.
  const deliveryFee = order.deliveryFee > 0 && money(subtotal + order.deliveryFee) === total
    ? order.deliveryFee : 0;
  return {
    code: order.code,
    date: order.billedAt || order.placedAt,
    customer: order.memberName,
    phone: order.memberPhone,
    storeName: store?.name || order.storeName || 'Sahakar 360 Pharmacy',
    storeAddress: store ? [store.area, store.city, store.state, store.pincode].filter(Boolean).join(', ') : '',
    storePhone: store?.phone || '',
    fulfillment: order.fulfillmentType === 'store_pickup' ? 'Store pickup' : 'Home delivery',
    orderStatus: order.status === 'delivered' ? 'Completed' : order.status === 'cancelled' ? 'Cancelled' : 'In progress',
    paymentStatus: order.paymentStatus === 'paid' || order.billStatus === 'paid' ? 'paid' : 'pending',
    rows, subtotal, deliveryFee,
    adjustment: money(total - subtotal - deliveryFee),
    total,
    fileName: `Sahakar-360-Invoice-${order.code.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
  };
}

export type Invoice = ReturnType<typeof buildInvoice>;

export function invoiceWhatsAppUrl(invoice: Invoice): string {
  let phone = invoice.phone.replace(/[\s()+-]/g, '');
  if (/^[6-9]\d{9}$/.test(phone)) phone = `91${phone}`;
  if (!/^91[6-9]\d{9}$/.test(phone)) throw new Error('The customer phone number is invalid. Use Share PDF or download the invoice instead.');
  const text = `Hello ${invoice.customer}, your Sahakar 360 invoice ${invoice.code} is INR ${invoice.total.toFixed(2)}. Payment: ${invoice.paymentStatus === 'paid' ? 'Paid' : 'Pending'}.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function downloadInvoice(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
