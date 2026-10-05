import { query } from '@/lib/db';
import { api } from '@/lib/api';
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

type Row = Record<string, unknown>;

function toLine(r: Row): OrderLine {
  return {
    id: String(r.id),
    status: fromEnum<OrderLineStatus>(String(r.stock_status ?? 'AVAILABLE')),
    name: String(r.name),
    pack: String(r.pack ?? ''),
    unitPrice: num(r.unit_price),
    mrp: num(r.mrp),
    qty: num(r.qty),
    // Real catalog category via order_line.product_id -> product.category_id
    // -> product_category.title — '' when the line has no linked product
    // (a manually-added line, or one placed before a product got deleted).
    categoryTitle: String(r.category_title ?? ''),
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
           o.member_id,
           m.name  AS member_name,
           m.phone AS member_phone,
           o.kind, o.status, o.item_count, o.mrp_total, o.paid_total, o.delivery_fee,
           o.store_id,
           o.reviewed_at, o.converted_to_bill_at, o.store_contacted_at,
           COALESCE(s.code, ms.code) AS store_code,
           COALESCE(s.name, ms.name) AS store_name,
           COALESCE(pm.name, o.reference) AS payment_method,
           pm.code AS payment_method_code,
           o.fulfillment_type::text AS fulfillment_type,
           o.payment_status::text AS payment_status,
           o.delivery_boy_id, db.name AS delivery_boy_name,
           o.placed_at, b.id AS bill_id, b.image AS bill_image, b.sent_at AS billed_at,
           b.amount AS bill_amount, b.discount_amount AS bill_discount, b.status::text AS bill_status,
           b.wallet_collected AS bill_wallet_collected, b.cash_collected AS bill_cash_collected,
           b.gpay_collected AS bill_gpay_collected,
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
    `SELECT ol.id, ol.order_id, ol.name, ol.pack, ol.unit_price, ol.mrp, ol.qty,
            ol.stock_status::text AS stock_status,
            pc.title AS category_title
       FROM app.order_line ol
       LEFT JOIN app.product p          ON p.id = ol.product_id
       LEFT JOIN app.product_category pc ON pc.id = p.category_id
      WHERE ol.order_id = ANY($1::bigint[])
      ORDER BY ol.id`,
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

  // What's actually supposed to end up on this order's bill, by name — the
  // Bills page's own Status column ("Pending" / "Billed" / "Partially
  // completed") reads by comparing this against `billLines`' own names, the
  // same "billable vs already billed" check `PrescriptionReviewModal`
  // already does for one prescription at a time (`billableMedicineNames`/
  // `billedMedicineNames`), just bulk-loaded here for every order in the
  // list at once. A standard order's own reviewed cart lines carry this
  // directly (`status = 'available'`); a prescription order's own
  // `order_line` rows are never populated at checkout (there's no cart),
  // so its billable set comes from its intake medicines instead — anything
  // not marked "Not possible".
  const prescriptionMedRows = await query<Row>(
    `SELECT po.order_id, pm.name
       FROM app.prescription_order po
       JOIN app.prescription_medicine pm ON pm.prescription_id = po.prescription_id
      WHERE po.order_id = ANY($1::bigint[])
        AND pm.status <> 'NOT_POSSIBLE'::app.prescription_medicine_status`,
    [ids],
  );
  const billableNamesByOrder = new Map<string, string[]>();
  for (const pr of prescriptionMedRows) {
    if (pr.order_id == null) continue;
    const key = String(pr.order_id);
    let bucket = billableNamesByOrder.get(key);
    if (!bucket) {
      bucket = [];
      billableNamesByOrder.set(key, bucket);
    }
    bucket.push(String(pr.name));
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
      memberId: r.member_id == null ? '' : String(r.member_id),
      memberName: String(r.member_name ?? '—'),
      memberPhone: String(r.member_phone ?? ''),
      kind: fromEnum<OrderKind>(String(r.kind)),
      status: fromEnum<OrderStatus>(String(r.status)),
      itemCount: num(r.item_count),
      mrpTotal: num(r.mrp_total),
      paidTotal: num(r.paid_total),
      deliveryFee: num(r.delivery_fee),
      storeId: r.store_id == null ? '' : String(r.store_id),
      storeCode: String(r.store_code ?? ''),
      storeName: String(r.store_name ?? '—'),
      reviewedAt: iso(r.reviewed_at) ?? '',
      convertedToBillAt: iso(r.converted_to_bill_at) ?? '',
      storeContactedAt: iso(r.store_contacted_at) ?? '',
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
      billDiscount: num(r.bill_discount),
      billId: r.bill_id == null ? '' : String(r.bill_id),
      billWalletCollected: num(r.bill_wallet_collected),
      billCashCollected: num(r.bill_cash_collected),
      billGpayCollected: num(r.bill_gpay_collected),
      billStatus: fromEnum<PaymentStatus>(String(r.bill_status ?? 'PENDING')),
      billLines: r.bill_id == null ? [] : billLinesByBill.get(String(r.bill_id)) ?? [],
      billableItemNames:
        String(r.kind) === 'PRESCRIPTION'
          ? billableNamesByOrder.get(String(r.id)) ?? []
          : (linesByOrder.get(String(r.id)) ?? [])
              .filter((l) => l.status === 'available')
              .map((l) => l.name),
    };
  });
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<void> {
  await query(
    'UPDATE app."order" SET status = $2::app.order_status WHERE id = $1',
    [id, status.toUpperCase()],
  );
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
