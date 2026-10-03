import type { Tone } from '@/components/ui/Badge';
import type { Order, OrderStatus } from '@/types';

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

/** The four fields the lifecycle reads — narrowed so a page that only joins
 *  these (the Prescriptions list, against a script's linked order) can use the
 *  same rule without building a whole [Order]. */
export type OrderLifecycleInput = Pick<
  Order,
  'status' | 'reviewedAt' | 'storeContactedAt' | 'convertedToBillAt'
>;

export function orderLifecycleStatus(order: OrderLifecycleInput): OrderLifecycleStatus {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'delivered') return 'completed';
  if (order.convertedToBillAt) return 'billing';
  // Either staff action counts — reviewing/saving the order (`reviewedAt`)
  // or calling/WhatsApping the member (`storeContactedAt`) — whichever
  // happens first. The member's own app reads this exact pair the same way
  // (`OrderStage.derive`'s `contacted`), so an order sitting on just one of
  // the two can't show "Processed" here while still reading "Pending" there.
  if (order.reviewedAt || order.storeContactedAt) return 'processed';
  return 'pending';
}

/**
 * A prescription's stage on the Prescriptions list and review modal: its linked
 * order's lifecycle, never the prescription's own `status` — that only records
 * that the script was turned into an order (`ordered`), which happens the moment
 * it is submitted, so echoing it as "Completed" marked brand-new scripts done
 * before anyone had read them. A script with no order yet reads "Pending".
 */
export function prescriptionLifecycleStatus(rx: {
  orderStatus: OrderStatus;
  orderReviewedAt: string;
  orderStoreContactedAt: string;
  orderConvertedToBillAt: string;
}): OrderLifecycleStatus {
  return orderLifecycleStatus({
    status: rx.orderStatus,
    reviewedAt: rx.orderReviewedAt,
    storeContactedAt: rx.orderStoreContactedAt,
    convertedToBillAt: rx.orderConvertedToBillAt,
  });
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
