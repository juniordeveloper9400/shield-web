import type { Tone } from '@/components/ui/Badge';
import type { OrderLineStatus } from '@/types';

/** `OrderLineStatus` — the counter's own note on each order line. Shared by
 *  `OrderReviewModal` (where it's set) and `BillEditorModal` (which only
 *  pre-fills a bill from 'available' lines), so the two can never disagree
 *  about what a status means. */
export const ORDER_LINE_STATUS_LABEL: Record<OrderLineStatus, string> = {
  available: 'Stock available',
  out_of_stock: 'Out of stock',
  not_possible: 'Not possible',
  customer_not_needed: 'Customer not needed',
};

export const ORDER_LINE_STATUS_TONE: Record<OrderLineStatus, Tone> = {
  available: 'green',
  out_of_stock: 'amber',
  not_possible: 'red',
  customer_not_needed: 'gray',
};

/** In display order — also the order grouped lines appear in after "Process". */
export const ORDER_LINE_STATUS_OPTIONS = (
  Object.keys(ORDER_LINE_STATUS_LABEL) as OrderLineStatus[]
).map((value) => ({ value, label: ORDER_LINE_STATUS_LABEL[value] }));
