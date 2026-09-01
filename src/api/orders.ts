import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type { Order, OrderKind, OrderLine, OrderStatus } from '@/types';

type Row = Record<string, unknown>;

function toLine(r: Row): OrderLine {
  return {
    name: String(r.name),
    pack: String(r.pack ?? ''),
    unitPrice: num(r.unit_price),
    mrp: num(r.mrp),
    qty: num(r.qty),
  };
}

/** Every member order, newest first, with its line items attached. */
export async function listOrders(): Promise<Order[]> {
  const rows = (await sql`
    SELECT o.id, o.code,
           m.name  AS member_name,
           m.phone AS member_phone,
           o.kind, o.status, o.item_count, o.mrp_total, o.paid_total, o.delivery_fee,
           COALESCE(s.code, ms.code) AS store_code,
           COALESCE(s.name, ms.name) AS store_name,
           COALESCE(pm.name, o.reference) AS payment_method,
           o.placed_at
    FROM app."order" o
    LEFT JOIN app.users m         ON m.id  = o.member_id
    LEFT JOIN app.shield_store s   ON s.id  = o.store_id
    LEFT JOIN app.shield_store ms  ON ms.id = m.home_store_id
    LEFT JOIN app.payment_method pm ON pm.id = o.payment_method_id
    ORDER BY o.placed_at DESC
  `) as Row[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));
  const lineRows = (await query<Row>(
    `SELECT order_id, name, pack, unit_price, mrp, qty
       FROM app.order_line
      WHERE order_id = ANY($1::bigint[])
      ORDER BY id`,
    [ids],
  ));

  const linesByOrder = new Map<string, OrderLine[]>();
  for (const lr of lineRows) {
    const key = String(lr.order_id);
    let bucket = linesByOrder.get(key);
    if (!bucket) {
      bucket = [];
      linesByOrder.set(key, bucket);
    }
    bucket.push(toLine(lr));
  }

  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    kind: fromEnum<OrderKind>(String(r.kind)),
    status: fromEnum<OrderStatus>(String(r.status)),
    itemCount: num(r.item_count),
    mrpTotal: num(r.mrp_total),
    paidTotal: num(r.paid_total),
    deliveryFee: num(r.delivery_fee),
    storeCode: String(r.store_code ?? ''),
    storeName: String(r.store_name ?? '—'),
    paymentMethod: String(r.payment_method ?? '—'),
    placedAt: iso(r.placed_at) ?? new Date(0).toISOString(),
    lines: linesByOrder.get(String(r.id)) ?? [],
  }));
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  await query(
    'UPDATE app."order" SET status = $2::app.order_status WHERE id = $1',
    [id, status.toUpperCase()],
  );
}
