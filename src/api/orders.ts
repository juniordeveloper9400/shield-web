import { ApiError, api } from '@/lib/api';
import { fromEnum, iso, num } from '@/lib/mappers';
import type {
  BillLine,
  FulfillmentType,
  Order,
  OrderKind,
  OrderLine,
  OrderLineStatus,
  OrderReceipt,
  OrderStatus,
  PaymentStatus,
} from '@/types';

/**
 * The order board: one card per order with its lines, bill, receipt and the
 * billable-items check. Built by backend/api (StaffOrderBoardService) under the
 * signed-in staff member's branch scope — the browser no longer reads orders
 * straight from the database.
 */
export async function listOrders(token: string | null): Promise<Order[]> {
  return api.get<Order[]>('/v1/staff/order-board', token);
}

/** One order by id, if this staff member may see it. Null when it is not theirs or does not exist. */
export async function getOrder(id: string, token: string | null): Promise<Order | null> {
  try {
    return await api.get<Order>(`/v1/staff/order-board/${id}`, token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Sets an order's fulfilment status — cancel, out for delivery, delivered.
 * Set by the counter, the prescription flow and the delivery hand-off. The
 * server applies the same branch scope as every other order write.
 */
export async function setOrderStatus(id: string, status: OrderStatus, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/orders/${id}/fulfilment-status`, { status: status.toUpperCase() }, token);
}

/**
 * "Save"/"Convert to bill" on the Orders review page: saves each existing
 * line's stock status, inserts any brand-new lines the admin added by hand
 * (`input.newLines` — never an edit to what the member actually checked out,
 * only ever a fresh row; see `OrderReviewModal`'s own "+ Add new item"), and
 * saves the order's branch, stamping `reviewed_at`. One statement — the line
 * writes ride in data-modifying CTEs — so a failure can't leave some of this
 * saved and the rest not.
 */
export async function saveOrderReview(
  id: string,
  input: {
    lines: { id: string; status: OrderLineStatus }[];
    newLines: { name: string; pack: string; unitPrice: number; qty: number; status: OrderLineStatus }[];
    storeId: string | null;
  },
  token: string | null,
): Promise<void> {
  await api.patch(
    `/v1/staff/orders/${id}/review`,
    {
      lines: input.lines.map((l) => ({ id: Number(l.id), status: l.status.toUpperCase() })),
      newLines: input.newLines.map((l) => ({
        name: l.name,
        pack: l.pack,
        unitPrice: l.unitPrice,
        qty: l.qty,
        status: l.status.toUpperCase(),
      })),
      storeId: input.storeId ? Number(input.storeId) : null,
    },
    token,
  );
}

/**
 * "Convert to bill →": the moment an order first appears on the Bills page.
 * Stamps `converted_to_bill_at` (keeping the first stamp if it was already
 * converted) and `reviewed_at` if the order somehow got here without a Submit.
 * A cancelled order can't be billed.
 */
export async function markOrderConvertedToBill(id: string, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/orders/${id}/converted-to-bill`, undefined, token);
}

/**
 * Staff used Call / WhatsApp for this order's member — the member's Track
 * order screen moves to "Store contact". The first click wins: a later
 * re-contact never moves the date the member sees. Returns the stamp, or ''
 * when the order is cancelled (nothing to contact them about).
 */
export async function markOrderStoreContacted(id: string, token: string | null): Promise<string> {
  const { storeContactedAt } = await api.patch<{ storeContactedAt: string | null }>(
    `/v1/staff/orders/${id}/store-contacted`,
    undefined,
    token,
  );
  return storeContactedAt ?? '';
}

/** Completion changes fulfilment only; it never collects money or marks a bill paid. */
export async function completeBilledOrder(id: string, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/orders/${id}/complete`, undefined, token);
}

/**
 * Attaches (or replaces) the store's invoice for this order in `app.bill` —
 * what the member's own order-detail screen reads as "Invoice from the
 * store". One row per order: sending again (e.g. "Replace") overwrites it
 * and bumps `sent_at`, rather than piling up a history.
 */
export async function sendOrderBill(id: string, image: string, token: string | null): Promise<void> {
  await api.put(`/v1/staff/orders/${id}/picture`, { image }, token);
}

/** Withdraws a bill sent in error — the member stops seeing it. `app.bill_line`
 *  rows for it are dropped automatically by the `ON DELETE CASCADE` on
 *  `bill_line.bill_id → bill.id`. */
export async function clearOrderBill(id: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/orders/${id}/bill`, token);
}

/**
 * The richer invoice path used to price a prescription's intake into a real
 * bill the member can see and pay — as opposed to {@link sendOrderBill}'s
 * simple "attach a picture" flow for standard orders. Upserts `app.bill` with
 * the priced `amount` (same one-row-per-order `ON CONFLICT` pattern as
 * `sendOrderBill`), replaces its `app.bill_line` rows when `opts.lines` is
 * given, and reflects the priced total onto the order itself so `mrpTotal`
 * shows what was actually billed.
 */
/**
 * The richer invoice path used to price a prescription's intake into a real
 * bill the member can see and pay — as opposed to {@link sendOrderBill}'s
 * simple "attach a picture" flow for standard orders. The server upserts the
 * one bill row with the priced `amount`, replaces its lines when `opts.lines`
 * is given, and reflects the priced total onto the order (see
 * `OrderService.sendInvoice` in backend/api). Returns the bill's `sent_at`.
 */
export async function sendOrderInvoice(
  id: string,
  opts: {
    image?: string;
    /** The net payable total — already `subtotal - discountAmount`. */
    amount: number;
    lines?: { name: string; pack?: string; unitPrice: number; qty: number }[];
    /** How much of the lines' subtotal was knocked off to reach `amount` —
     *  purely the audit trail; 0 when no discount was applied. */
    discountAmount?: number;
  },
  token: string | null,
): Promise<string> {
  const { sentAt } = await api.put<{ sentAt: string }>(
    `/v1/staff/orders/${id}/invoice`,
    {
      image: opts.image ?? '',
      amount: opts.amount,
      discountAmount: opts.discountAmount ?? 0,
      ...(opts.lines ? { lines: opts.lines } : {}),
    },
    token,
  );
  return sentAt;
}
