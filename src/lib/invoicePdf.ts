import { jsPDF } from 'jspdf';
import type { Invoice } from './invoice';

/** Render Unicode through the browser's fonts, with explicit A4 pagination.
 * The PDF is a file, not a link to a staff-only page or a print-dialog shortcut. */
export async function createInvoicePdf(invoice: Invoice): Promise<File> {
  await document.fonts.ready;
  const pages: HTMLCanvasElement[] = [];
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let y = 36;
  const left = 36;
  const right = 584;
  const bottom = 807;
  const currency = (n: number) => `INR ${n.toFixed(2)}`;

  function font(size = 11, bold = false) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px Arial, sans-serif`;
    ctx.fillStyle = '#17233b';
  }
  function text(value: string, x: number, top: number, align: CanvasTextAlign = 'left', size = 11, bold = false) {
    font(size, bold);
    ctx.textAlign = align;
    ctx.fillText(value, x, top);
  }
  function line() {
    ctx.strokeStyle = '#dce3ec';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    y += 14;
  }
  function newPage(continued = false) {
    canvas = document.createElement('canvas');
    canvas.width = 1240; canvas.height = 1754;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not create the invoice PDF. Please use Print.');
    ctx = context;
    ctx.scale(2, 2);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 620, 877);
    pages.push(canvas);
    y = 36;
    if (continued) { text(`SHIELD Invoice ${invoice.code} — continued`, left, y, 'left', 11, true); y += 24; }
  }
  function ensure(height: number) { if (y + height > bottom) newPage(true); }
  function wrap(value: string, width: number, size = 11): string[] {
    font(size);
    const lines: string[] = [];
    let current = '';
    // Character wrapping also handles long medicine names and scripts without spaces.
    for (const char of Array.from(value)) {
      if (char === '\n' || (current && ctx.measureText(current + char).width > width)) {
        lines.push(current); current = char === '\n' ? '' : char;
      } else current += char;
    }
    if (current || !lines.length) lines.push(current);
    return lines;
  }
  function paragraph(value: string, size = 11, bold = false) {
    for (const row of wrap(value, right - left, size)) {
      ensure(size + 7); text(row, left, y, 'left', size, bold); y += size + 7;
    }
  }
  function tableHeader() {
    ensure(30);
    ctx.fillStyle = '#eef3fa'; ctx.fillRect(left, y - 12, right - left, 25);
    text('Item / description', left + 6, y, 'left', 10, true);
    text('Qty', 388, y, 'right', 10, true);
    text('Unit price', 478, y, 'right', 10, true);
    text('Amount', right - 6, y, 'right', 10, true);
    y += 29;
  }

  newPage();
  paragraph('SHIELD PHARMACY', 19, true);
  paragraph(invoice.storeName, 12, true);
  if (invoice.storeAddress) paragraph(invoice.storeAddress, 10);
  if (invoice.storePhone) paragraph(`Phone: ${invoice.storePhone}`, 10);
  y += 7; line();
  paragraph(`INVOICE  ${invoice.code}`, 15, true);
  paragraph(`Date: ${new Date(invoice.date).toLocaleString('en-IN')}`, 10);
  paragraph(`Order: ${invoice.orderStatus}   |   Payment: ${invoice.paymentStatus === 'paid' ? 'Paid' : 'Pending'}`, 11, true);
  y += 5;
  paragraph(`Billed to: ${invoice.customer}`, 12, true);
  paragraph(`Phone: ${invoice.phone}`, 10);
  paragraph(`Fulfilment: ${invoice.fulfillment}`, 10);
  y += 9; tableHeader();
  if (!invoice.rows.length) paragraph('No itemized lines were recorded for this bill.', 10);
  for (const row of invoice.rows) {
    const description = wrap(`${row.name}${row.pack ? ` (${row.pack})` : ''}`, 315);
    if (y + Math.min(description.length * 16 + 14, 150) > bottom) { newPage(true); tableHeader(); }
    text(String(row.qty), 388, y, 'right');
    text(currency(row.unitPrice), 478, y, 'right', 10);
    text(currency(row.amount), right - 6, y, 'right', 10, true);
    for (const part of description) {
      if (y + 20 > bottom) { newPage(true); tableHeader(); }
      text(part, left + 6, y); y += 16;
    }
    y += 4; line();
  }
  ensure(135);
  function totalRow(label: string, amount: number, bold = false) {
    text(label, 365, y, 'right', bold ? 13 : 11, bold);
    text(currency(amount), right - 6, y, 'right', bold ? 13 : 11, bold); y += 22;
  }
  totalRow('Subtotal', invoice.subtotal);
  if (invoice.deliveryFee) totalRow('Delivery fee', invoice.deliveryFee);
  if (invoice.adjustment) totalRow('Bill adjustment', invoice.adjustment);
  totalRow('TOTAL', invoice.total, true);
  y += 12;
  paragraph('Thank you for choosing SHIELD Pharmacy.', 10);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: `Invoice ${invoice.code}`, author: 'SHIELD Pharmacy' });
  pages.forEach((page, index) => {
    const footer = page.getContext('2d')!;
    footer.font = '9px Arial, sans-serif'; footer.fillStyle = '#64748b'; footer.textAlign = 'right';
    footer.fillText(`Page ${index + 1} of ${pages.length}`, right, 847);
    if (index) pdf.addPage();
    pdf.addImage(page, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  });
  return new File([pdf.output('blob')], invoice.fileName, { type: 'application/pdf' });
}
