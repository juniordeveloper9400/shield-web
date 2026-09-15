import { query } from '@/lib/db';

type Row = Record<string, unknown>;

/** A DELIVERY-role staff account — who a cash order can be handed to. */
export interface DeliveryBoy {
  id: string;
  name: string;
  storeCode: string;
}

/**
 * Delivery boys at one branch (or every branch when [storeCode] is omitted —
 * used by a Super Admin/Admin's assignment picker, which isn't store-bound).
 */
export async function listDeliveryBoys(storeCode?: string): Promise<DeliveryBoy[]> {
  const rows = await query<Row>(
    `
    SELECT au.id, au.name, s.code AS store_code
      FROM app.admin_user au
      JOIN app.shield_store s ON s.id = au.store_id
     WHERE au.role = 'DELIVERY'::app.admin_role
       AND au.is_active = true
       AND ($1::text IS NULL OR s.code = $1)
     ORDER BY au.name
    `,
    [storeCode ?? null],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    storeCode: String(r.store_code ?? ''),
  }));
}

/** Assigns (or clears, passing null) which delivery boy carries a cash order. */
export async function assignDeliveryBoy(
  orderId: string,
  deliveryBoyId: string | null,
): Promise<void> {
  await query(
    `UPDATE app."order" SET delivery_boy_id = $2, updated_at = now() WHERE id = $1`,
    [orderId, deliveryBoyId],
  );
}

/**
 * Marks a cash order's payment as collected — by the delivery boy on handoff,
 * or by store staff at pickup. Also settles the linked bill, if one exists,
 * so a priced prescription invoice shows paid the same moment the order does.
 */
export async function markCashCollected(orderId: string): Promise<void> {
  await query(
    `UPDATE app."order"
        SET payment_status = 'PAID'::app.order_payment_status,
            paid_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [orderId],
  );
  await query(
    `UPDATE app.bill
        SET status = 'PAID'::app.order_payment_status,
            paid_at = now(),
            updated_at = now()
      WHERE order_id = $1`,
    [orderId],
  );
}

/** One row of the delivery boy's own queue — just what their portal needs. */
export interface DeliveryOrder {
  id: string;
  code: string;
  memberName: string;
  memberPhone: string;
  status: string;
  fulfillmentType: string;
  paymentStatus: string;
  paidTotal: number;
  mrpTotal: number;
  storeCode: string;
  storeName: string;
  deliveryBoyId: string | null;
  placedAt: string;
}

function toDeliveryOrder(r: Row): DeliveryOrder {
  return {
    id: String(r.id),
    code: String(r.code),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    status: String(r.status ?? '').toLowerCase(),
    fulfillmentType: String(r.fulfillment_type ?? '').toLowerCase(),
    paymentStatus: String(r.payment_status ?? '').toLowerCase(),
    paidTotal: Number(r.paid_total ?? 0),
    mrpTotal: Number(r.mrp_total ?? 0),
    storeCode: String(r.store_code ?? ''),
    storeName: String(r.store_name ?? ''),
    deliveryBoyId: r.delivery_boy_id == null ? null : String(r.delivery_boy_id),
    placedAt: r.placed_at instanceof Date ? r.placed_at.toISOString() : String(r.placed_at ?? ''),
  };
}

const DELIVERY_ORDER_SELECT = `
  SELECT o.id, o.code, m.name AS member_name, m.phone AS member_phone,
         o.status::text AS status, o.fulfillment_type::text AS fulfillment_type,
         o.payment_status::text AS payment_status, o.paid_total, o.mrp_total,
         s.code AS store_code, s.name AS store_name,
         o.delivery_boy_id, o.placed_at
    FROM app."order" o
    JOIN app.users m ON m.id = o.member_id
    LEFT JOIN app.shield_store s ON s.id = o.store_id
`;

/**
 * Cash orders at [storeCode] not yet claimed by anyone — what a delivery boy
 * sees to pick up. Excludes wallet-paid orders (nothing to collect) and
 * anything already delivered/cancelled.
 */
export async function listAvailableForDelivery(storeCode: string): Promise<DeliveryOrder[]> {
  const rows = await query<Row>(
    `${DELIVERY_ORDER_SELECT}
     WHERE s.code = $1
       AND o.delivery_boy_id IS NULL
       AND o.payment_status = 'PENDING'::app.order_payment_status
       AND o.status NOT IN ('DELIVERED', 'CANCELLED')
     ORDER BY o.placed_at`,
    [storeCode],
  );
  return rows.map(toDeliveryOrder);
}

/** This delivery boy's own claimed orders, in progress or newly settled. */
export async function listAssignedToMe(deliveryBoyId: string): Promise<DeliveryOrder[]> {
  const rows = await query<Row>(
    `${DELIVERY_ORDER_SELECT}
     WHERE o.delivery_boy_id = $1
       AND o.status NOT IN ('DELIVERED', 'CANCELLED')
     ORDER BY o.placed_at`,
    [deliveryBoyId],
  );
  return rows.map(toDeliveryOrder);
}
