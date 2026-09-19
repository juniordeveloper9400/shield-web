import { query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type {
  BillLine,
  FulfillmentType,
  Order,
  OrderKind,
  OrderLine,
  OrderReceipt,
  OrderStatus,
  PaymentStatus,
} from '@/types';

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

function toBillLine(r: Row): BillLine {
  return {
    name: String(r.name),
    pack: String(r.pack ?? ''),
    unitPrice: num(r.unit_price),
    qty: num(r.qty),
  };
}

/** The columns and joins every order read needs — shared between
 *  {@link listOrders} (every order) and {@link getOrder} (one, by id), so
 *  the two can never map a row differently. */
const ORDER_SELECT = `
    SELECT o.id, o.code,
           m.name  AS member_name,
           m.phone AS member_phone,
           o.kind, o.status, o.item_count, o.mrp_total, o.paid_total, o.delivery_fee,
           COALESCE(s.code, ms.code) AS store_code,
           COALESCE(s.name, ms.name) AS store_name,
           COALESCE(pm.name, o.reference) AS payment_method,
           pm.code AS payment_method_code,
           o.fulfillment_type::text AS fulfillment_type,
           o.payment_status::text AS payment_status,
           o.delivery_boy_id, db.name AS delivery_boy_name,
           o.placed_at, b.id AS bill_id, b.image AS bill_image, b.sent_at AS billed_at,
           b.amount AS bill_amount, b.status::text AS bill_status,
           r.payer_name AS receipt_payer_name, r.reference AS receipt_reference,
           r.amount AS receipt_amount, r.file_name AS receipt_file_name,
           r.image AS receipt_image, r.uploaded_at AS receipt_uploaded_at
    FROM app."order" o
    LEFT JOIN app.users m         ON m.id  = o.member_id
    LEFT JOIN app.shield_store s   ON s.id  = o.store_id
    LEFT JOIN app.shield_store ms  ON ms.id = m.home_store_id
    LEFT JOIN app.payment_method pm ON pm.id = o.payment_method_id
    LEFT JOIN app.admin_user db     ON db.id = o.delivery_boy_id
    LEFT JOIN app.bill b            ON b.order_id = o.id
    LEFT JOIN LATERAL (
      SELECT payer_name, reference, amount, file_name, image, uploaded_at
      FROM app.order_receipt
      WHERE order_id = o.id
      ORDER BY uploaded_at DESC
      LIMIT 1
    ) r ON true`;

/** Every member order, newest first, with its line items attached. */
export async function listOrders(): Promise<Order[]> {
  const rows = await query<Row>(`${ORDER_SELECT} ORDER BY o.placed_at DESC`);
  return mapOrderRows(rows);
}

/** One order, by id — the same shape {@link listOrders} returns, for a
 *  caller that only needs to read back a single order it already knows the
 *  id of (e.g. re-checking a bill's real, saved state) rather than fetching
 *  and filtering the whole list. Null when no such order exists. */
export async function getOrder(id: string): Promise<Order | null> {
  const rows = await query<Row>(`${ORDER_SELECT} WHERE o.id = $1::bigint`, [id]);
  const orders = await mapOrderRows(rows);
  return orders[0] ?? null;
}

async function mapOrderRows(rows: Row[]): Promise<Order[]> {
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

  const billIds = rows
    .map((r) => (r.bill_id == null ? null : String(r.bill_id)))
    .filter((id): id is string => id !== null);
  const billLineRows =
    billIds.length === 0
      ? []
      : await query<Row>(
          `SELECT bill_id, name, pack, unit_price, qty
             FROM app.bill_line
            WHERE bill_id = ANY($1::bigint[])
            ORDER BY id`,
          [billIds],
        );

  const billLinesByBill = new Map<string, BillLine[]>();
  for (const blr of billLineRows) {
    const key = String(blr.bill_id);
    let bucket = billLinesByBill.get(key);
    if (!bucket) {
      bucket = [];
      billLinesByBill.set(key, bucket);
    }
    bucket.push(toBillLine(blr));
  }

  return rows.map((r) => {
    const receipt: OrderReceipt | null = r.receipt_uploaded_at
      ? {
          payerName: String(r.receipt_payer_name ?? ''),
          reference: String(r.receipt_reference ?? ''),
          amount: num(r.receipt_amount),
          fileName: String(r.receipt_file_name ?? ''),
          image: String(r.receipt_image ?? ''),
          uploadedAt: iso(r.receipt_uploaded_at) ?? new Date(0).toISOString(),
        }
      : null;
    return {
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
      paymentMethodCode: String(r.payment_method_code ?? ''),
      fulfillmentType: fromEnum<FulfillmentType>(String(r.fulfillment_type ?? 'HOME_DELIVERY')),
      paymentStatus: fromEnum<PaymentStatus>(String(r.payment_status ?? 'PENDING')),
      deliveryBoyId: r.delivery_boy_id == null ? '' : String(r.delivery_boy_id),
      deliveryBoyName: String(r.delivery_boy_name ?? ''),
      placedAt: iso(r.placed_at) ?? new Date(0).toISOString(),
      lines: linesByOrder.get(String(r.id)) ?? [],
      receipt,
      billImage: String(r.bill_image ?? ''),
      billedAt: iso(r.billed_at) ?? '',
      billAmount: num(r.bill_amount),
      billStatus: fromEnum<PaymentStatus>(String(r.bill_status ?? 'PENDING')),
      billLines: r.bill_id == null ? [] : billLinesByBill.get(String(r.bill_id)) ?? [],
    };
  });
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  await query(
    'UPDATE app."order" SET status = $2::app.order_status WHERE id = $1',
    [id, status.toUpperCase()],
  );
}

/** Completion changes fulfilment only; it never collects money or marks a bill paid. */
export async function completeBilledOrder(id: string): Promise<void> {
  const rows = await query<{ id: unknown }>(
    `UPDATE app."order" o SET status = 'DELIVERED'::app.order_status, updated_at = now()
       WHERE o.id = $1 AND o.status <> 'CANCELLED'::app.order_status
         AND EXISTS (SELECT 1 FROM app.bill b WHERE b.order_id = o.id AND b.amount > 0)
       RETURNING o.id`,
    [id],
  );
  if (!rows.length) throw new Error('Save a priced bill first. Cancelled orders cannot be completed.');
}

/**
 * Attaches (or replaces) the store's invoice for this order in `app.bill` —
 * what the member's own order-detail screen reads as "Invoice from the
 * store". One row per order: sending again (e.g. "Replace") overwrites it
 * and bumps `sent_at`, rather than piling up a history.
 */
export async function sendOrderBill(id: string, image: string): Promise<void> {
  await query(
    `INSERT INTO app.bill (order_id, image, sent_at, updated_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (order_id)
     DO UPDATE SET image = excluded.image, sent_at = now(), updated_at = now()`,
    [id, image],
  );
}

/** Withdraws a bill sent in error — the member stops seeing it. `app.bill_line`
 *  rows for it are dropped automatically by the `ON DELETE CASCADE` on
 *  `bill_line.bill_id → bill.id`. */
export async function clearOrderBill(id: string): Promise<void> {
  await query('DELETE FROM app.bill WHERE order_id = $1', [id]);
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
export async function sendOrderInvoice(
  id: string,
  opts: {
    image?: string;
    amount: number;
    lines?: { name: string; pack?: string; unitPrice: number; qty: number }[];
  },
): Promise<string> {
  // app.bill.image is NOT NULL (it predates this priced-invoice path, which
  // often has no picture at all — a prescription bill is built from typed
  // line items, not a photo). '' is the same "no image" the read side
  // already treats a blank/whitespace image as (see listOrders/fetchPrescriptions),
  // so a lineitem-only bill inserts cleanly instead of violating the column.
  const upserted = await query<{ id: unknown; sent_at: unknown }>(
    `INSERT INTO app.bill (order_id, image, amount, sent_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (order_id)
     DO UPDATE SET image = CASE WHEN excluded.image = '' THEN app.bill.image ELSE excluded.image END,
                   amount = excluded.amount,
                   sent_at = now(),
                   updated_at = now()
     RETURNING id, sent_at`,
    [id, opts.image ?? '', opts.amount],
  );

  let billId = upserted[0]?.id == null ? null : String(upserted[0].id);
  if (billId === null) {
    const found = await query<{ id: unknown }>(
      'SELECT id FROM app.bill WHERE order_id = $1',
      [id],
    );
    billId = found[0]?.id == null ? null : String(found[0].id);
  }

  if (opts.lines && billId !== null) {
    await query('DELETE FROM app.bill_line WHERE bill_id = $1', [billId]);
    for (const line of opts.lines) {
      await query(
        `INSERT INTO app.bill_line (bill_id, name, pack, unit_price, qty)
         VALUES ($1, $2, $3, $4, $5)`,
        [billId, line.name, line.pack ?? '', line.unitPrice, line.qty],
      );
    }
  }

  await query(
    'UPDATE app."order" SET mrp_total = $2, updated_at = now() WHERE id = $1',
    [id, opts.amount],
  );
  return String(upserted[0]?.sent_at ?? '');
}
