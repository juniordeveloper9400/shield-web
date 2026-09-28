import type { Tone } from '@/components/ui/Badge';
import type { Order } from '@/types';

/**
 * Where a standard order actually stands, at a glance — distinct from
 * `Order.status` (`processing`/`out_for_delivery`/`delivered`/`cancelled`,
 * the fulfilment-tracking status the member's own app shows), which doesn't
 * say anything about review or billing progress. Milestone-based, not a
 * rename of the raw status: a `processing` order that's already been
 * reviewed and converted to a bill still reads as "Billing", not "Pending".
 * Shared between `OrdersPage` (the stat cards, filter and table) and
 * `OrderReviewModal` (the badge at the top), so they can never disagree.
 */
export type OrderLifecycleStatus = 'pending' | 'processed' | 'billing' | 'completed' | 'cancelled';

export function orderLifecycleStatus(order: Order): OrderLifecycleStatus {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'delivered') return 'completed';
  if (order.convertedToBillAt) return 'billing';
  if (order.reviewedAt) return 'processed';
  return 'pending';
}

export const ORDER_LIFECYCLE_LABEL: Record<OrderLifecycleStatus, string> = {
  pending: 'Pending',
  processed: 'Processed',
  billing: 'Billing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const ORDER_LIFECYCLE_TONE: Record<OrderLifecycleStatus, Tone> = {
  pending: 'amber',
  processed: 'blue',
  billing: 'violet',
  completed: 'green',
  cancelled: 'red',
};

/** In display order — also the order the stat cards appear in. Cancelled is
 *  left out here (it's not a milestone an order progresses through) but
 *  still filterable — `OrdersPage` appends it to this list for the dropdown. */
export const ORDER_LIFECYCLE_OPTIONS = (
  ['pending', 'processed', 'billing', 'completed'] as const
).map((value) => ({ value, label: ORDER_LIFECYCLE_LABEL[value] }));
