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

/** One item on a delivery order — just enough for the delivery boy/admin to check the parcel against. */
export interface DeliveryOrderItem {
  name: string;
  pack: string;
  qty: number;
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
  /** Where it's going — blank on an order with no address on file. */
  address: string;
  items: DeliveryOrderItem[];
  itemCount: number;
}

function toDeliveryOrder(r: Row): Omit<DeliveryOrder, 'items'> {
  const addressParts = [r.house, r.area, r.landmark, r.city, r.pincode]
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean);
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
    address: addressParts.join(', '),
    itemCount: Number(r.item_count ?? 0),
  };
}

/** Attaches each order's `order_line` rows — one extra query, not one per order. */
async function withItems(rows: Omit<DeliveryOrder, 'items'>[]): Promise<DeliveryOrder[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const lineRows = await query<Row>(
    `SELECT order_id, name, pack, qty
       FROM app.order_line
      WHERE order_id = ANY($1::bigint[])
      ORDER BY id`,
    [ids],
  );
  const byOrder = new Map<string, DeliveryOrderItem[]>();
  for (const lr of lineRows) {
    const key = String(lr.order_id);
    const bucket = byOrder.get(key) ?? [];
    bucket.push({ name: String(lr.name), pack: String(lr.pack ?? ''), qty: Number(lr.qty ?? 0) });
    byOrder.set(key, bucket);
  }
  return rows.map((r) => ({ ...r, items: byOrder.get(r.id) ?? [] }));
}

const DELIVERY_ORDER_SELECT = `
  SELECT o.id, o.code, m.name AS member_name, m.phone AS member_phone,
         o.status::text AS status, o.fulfillment_type::text AS fulfillment_type,
         o.payment_status::text AS payment_status, o.paid_total, o.mrp_total,
         o.item_count,
         s.code AS store_code, s.name AS store_name,
         o.delivery_boy_id, o.placed_at,
         a.house, a.area, a.landmark, a.city, a.pincode
    FROM app."order" o
    JOIN app.users m ON m.id = o.member_id
    LEFT JOIN app.shield_store s ON s.id = o.store_id
    LEFT JOIN app.member_address a ON a.id = o.delivery_address_id
`;

/**
 * Home-delivery orders at [storeCode] not yet claimed by anyone — what a
 * delivery boy sees to pick up. Every unclaimed order that needs a physical
 * hand-off, wallet-paid or still cash-pending alike: a wallet-paid order has
 * nothing left to collect, but it still has to physically reach the member,
 * so it belongs in this queue too. Store-pickup orders never appear here —
 * there is no delivery to assign. Excludes anything already
 * delivered/cancelled.
 */
export async function listAvailableForDelivery(storeCode: string): Promise<DeliveryOrder[]> {
  const rows = await query<Row>(
    `${DELIVERY_ORDER_SELECT}
     WHERE s.code = $1
       AND o.fulfillment_type = 'HOME_DELIVERY'::app.fulfillment_type
       AND o.delivery_boy_id IS NULL
       AND o.status NOT IN ('DELIVERED', 'CANCELLED')
     ORDER BY o.placed_at`,
    [storeCode],
  );
  return withItems(rows.map(toDeliveryOrder));
}

/** This delivery boy's own claimed orders, in progress or newly settled. */
export async function listAssignedToMe(deliveryBoyId: string): Promise<DeliveryOrder[]> {
  const rows = await query<Row>(
    `${DELIVERY_ORDER_SELECT}
     WHERE o.delivery_boy_id = $1
       AND o.fulfillment_type = 'HOME_DELIVERY'::app.fulfillment_type
       AND o.status NOT IN ('DELIVERED', 'CANCELLED')
     ORDER BY o.placed_at`,
    [deliveryBoyId],
  );
  return withItems(rows.map(toDeliveryOrder));
}
