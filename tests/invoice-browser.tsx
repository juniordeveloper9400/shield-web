import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InvoiceModal } from '../src/components/orders/InvoiceModal';
import { BillEditorModal } from '../src/components/orders/BillEditorModal';
import type { Order } from '../src/types';
import '../src/index.css';

const order: Order = {
  id: '42', code: 'RX-TEST-42', memberName: 'Sample member', memberPhone: '9000000000',
  kind: 'prescription', status: 'processing', itemCount: 6, mrpTotal: 395, paidTotal: 0,
  deliveryFee: 25, storeCode: 'TEST', storeName: 'SHIELD Pharmacy — Test branch',
  paymentMethod: 'Cash', paymentMethodCode: 'cash', fulfillmentType: 'home_delivery',
  paymentStatus: 'pending', deliveryBoyId: '', deliveryBoyName: '',
  placedAt: '2026-09-19T12:00:00Z', billedAt: '2026-09-19T12:30:00Z',
  lines: [], receipt: null, billImage: '', billAmount: 395, billStatus: 'pending',
  billLines: [{ name: 'Medicine A', pack: 'Tablet', qty: 1, unitPrice: 100 },
    { name: 'Medicine B', pack: 'Tablet', qty: 5, unitPrice: 59 }],
};

function Fixture() {
  const [scenario, setScenario] = useState('pending');
  const [open, setOpen] = useState(true);
  const longLines = Array.from({ length: 85 }, (_, i) => ({
    name: `Medicine ${i + 1} — മലയാളം — long description for pagination`, pack: 'Tablet', qty: 2, unitPrice: 10,
  }));
  const current = scenario === 'image' ? { ...order, billAmount: 500.50, billLines: [] }
    : scenario === 'long' ? { ...order, status: 'delivered' as const, billLines: longLines, billAmount: 1700 }
    : scenario === 'completed' ? { ...order, status: 'delivered' as const } : order;
  function change(value: string) { setScenario(value); setOpen(true); }
  (window as any).__invoiceFixture = change;
  return <>
    <h1>Invoice regression fixture — no production database</h1>
    <div>{['pending', 'completed', 'long', 'editor', 'image'].map(value => <button key={value} onClick={() => change(value)}>{value}</button>)}</div>
    {scenario === 'editor' || scenario === 'image' ? <BillEditorModal key={scenario} order={current} open={open} onClose={() => setOpen(false)} onSaved={() => {}} />
      : <InvoiceModal key={scenario} order={current} store={undefined} open={open} onClose={() => setOpen(false)} />}
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
