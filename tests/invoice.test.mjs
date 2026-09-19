import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvoice, invoiceWhatsAppUrl, canCompleteInvoice, formatInvoiceCurrency } from '../src/lib/invoice.ts';

const order = {
  id: '42', code: 'RX-42', memberName: 'Member', memberPhone: '+91 98765 43210',
  storeName: 'SHIELD Pharmacy', billAmount: 395, billStatus: 'pending',
  paymentStatus: 'pending', status: 'processing', deliveryFee: 25, paidTotal: 0,
  placedAt: '2026-09-19T12:00:00Z', billedAt: '2026-09-19T12:30:00Z',
  billLines: [{ name: 'Medicine A', pack: 'Tablet', qty: 1, unitPrice: 100 },
    { name: 'Medicine B', pack: 'Tablet', qty: 5, unitPrice: 59 }], lines: [],
};

test('invoice display retains paise instead of rounding to whole rupees', () => {
  assert.match(formatInvoiceCurrency(100.50), /100\.50/);
  assert.match(formatInvoiceCurrency(395), /395\.00/);
});

test('saved bill total wins and does not charge delivery twice', () => {
  const invoice = buildInvoice(order);
  assert.equal(invoice.total, 395);
  assert.equal(invoice.subtotal, 395);
  assert.equal(invoice.deliveryFee, 0);
  assert.equal(invoice.adjustment, 0);
  assert.equal(invoice.paymentStatus, 'pending');
  assert.equal(invoice.rows[1].amount, 295);
});

test('saved amount is used even for an invoice without bill lines', () => {
  assert.equal(buildInvoice({ ...order, billLines: [], billAmount: 500, paidTotal: 200 }).total, 500);
});

test('line rounding and adjustment reconcile exactly to the saved total', () => {
  const invoice = buildInvoice({ ...order, billAmount: 1,
    billLines: [{ name: 'Item', qty: 3, unitPrice: 0.1, pack: '' }] });
  assert.equal(invoice.subtotal, 0.3);
  assert.equal(invoice.adjustment, 0.7);
});

test('completion leaves actual payment status intact', () => {
  assert.equal(canCompleteInvoice(order), true);
  assert.equal(canCompleteInvoice({ ...order, billAmount: 0 }), false);
  assert.equal(canCompleteInvoice({ ...order, status: 'cancelled' }), false);
  assert.equal(canCompleteInvoice({ ...order, status: 'delivered' }), false);
  assert.equal(buildInvoice({ ...order, status: 'delivered' }).paymentStatus, 'pending');
  assert.equal(buildInvoice({ ...order, paymentStatus: 'paid' }).paymentStatus, 'paid');
});

test('WhatsApp targets the customer and includes real invoice amount', () => {
  const url = new URL(invoiceWhatsAppUrl(buildInvoice(order)));
  assert.equal(url.hostname, 'wa.me');
  assert.equal(url.pathname, '/919876543210');
  assert.match(url.searchParams.get('text'), /RX-42/);
  assert.match(url.searchParams.get('text'), /395\.00/);
  assert.throws(() => invoiceWhatsAppUrl(buildInvoice({ ...order, memberPhone: '' })));
});
