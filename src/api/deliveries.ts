import { api } from '@/lib/api';

/** A DELIVERY-role staff account — who a cash order can be handed to. */
export interface DeliveryBoy {
  id: string;
  name: string;
  storeCode: string;
}

/** A `GET /v1/staff/delivery-boys` row — `id` comes back as a JSON number
 *  (a bigint identity column), not {@link DeliveryBoy.id}'s string. */
interface DeliveryBoyApiRow {
  id: number;
  name: string;
  storeCode: string | null;
}

/**
 * Delivery boys at one branch (or every branch when [storeCode] is omitted —
 * used by a Super Admin/Admin's assignment picker, which isn't store-bound).
 * Reads through backend/api's staff commerce routes now, not Neon directly.
 */
export async function listDeliveryBoys(storeCode: string | undefined, token: string | null): Promise<DeliveryBoy[]> {
  const path = storeCode ? `/v1/staff/delivery-boys?storeCode=${encodeURIComponent(storeCode)}` : '/v1/staff/delivery-boys';
  const rows = await api.get<DeliveryBoyApiRow[]>(path, token);
  return rows.map((r) => ({ id: String(r.id), name: r.name, storeCode: r.storeCode ?? '' }));
}

/**
 * Assigns (or clears, passing null) which delivery boy carries a cash order.
 * The server refuses a DELIVERY-role caller handing an order to anyone but
 * themselves — see `OrderService.assignDeliveryBoy`'s own doc.
 */
export async function assignDeliveryBoy(
  orderId: string,
  deliveryBoyId: string | null,
  token: string | null,
): Promise<void> {
  await api.patch(
    `/v1/staff/orders/${orderId}/delivery-boy`,
    { deliveryBoyId: deliveryBoyId === null ? null : Number(deliveryBoyId) },
    token,
  );
}

/**
 * Marks a cash order's payment as collected — by the delivery boy on handoff,
 * or by store staff at pickup. Also settles the linked bill, if one exists,
 * so a priced prescription invoice shows paid the same moment the order does.
 */
export async function markCashCollected(orderId: string, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/orders/${orderId}/cash-collected`, undefined, token);
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

/** A `GET /v1/staff/deliveries/...` row — several ids come back as JSON
 *  numbers (bigint identity columns), not the string {@link DeliveryOrder}
 *  fields they map to. */
interface DeliveryOrderApiRow {
  id: number;
  code: string;
  memberName: string;
  memberPhone: string;
  status: string;
  fulfillmentType: string;
  paymentStatus: string;
  paidTotal: string | number;
  mrpTotal: string | number;
  itemCount: number;
  storeCode: string | null;
  storeName: string | null;
  deliveryBoyId: number | null;
  placedAt: string;
  address: string;
  items: DeliveryOrderItem[];
}

function toDeliveryOrder(r: DeliveryOrderApiRow): DeliveryOrder {
  return {
    id: String(r.id),
    code: r.code,
    memberName: r.memberName || '—',
    memberPhone: r.memberPhone,
    status: r.status.toLowerCase(),
    fulfillmentType: r.fulfillmentType.toLowerCase(),
    paymentStatus: r.paymentStatus.toLowerCase(),
    paidTotal: Number(r.paidTotal),
    mrpTotal: Number(r.mrpTotal),
    storeCode: r.storeCode ?? '',
    storeName: r.storeName ?? '',
    deliveryBoyId: r.deliveryBoyId == null ? null : String(r.deliveryBoyId),
    placedAt: r.placedAt,
    address: r.address,
    items: r.items,
    itemCount: r.itemCount,
  };
}

/**
 * Home-delivery orders at [storeCode] not yet claimed by anyone — what a
 * delivery boy sees to pick up. Every unclaimed order that needs a physical
 * hand-off, wallet-paid or still cash-pending alike: a wallet-paid order has
 * nothing left to collect, but it still has to physically reach the member,
 * so it belongs in this queue too. Store-pickup orders never appear here —
 * there is no delivery to assign. Excludes anything already
 * delivered/cancelled.
 */
export async function listAvailableForDelivery(storeCode: string, token: string | null): Promise<DeliveryOrder[]> {
  const rows = await api.get<DeliveryOrderApiRow[]>(
    `/v1/staff/deliveries/available?storeCode=${encodeURIComponent(storeCode)}`,
    token,
  );
  return rows.map(toDeliveryOrder);
}

/** This delivery boy's own claimed orders, in progress or newly settled —
 *  resolved server-side from the signed-in session, not a client-supplied
 *  id (the old direct-SQL version took one; the server no longer does). */
export async function listAssignedToMe(token: string | null): Promise<DeliveryOrder[]> {
  const rows = await api.get<DeliveryOrderApiRow[]>('/v1/staff/deliveries/assigned-to-me', token);
  return rows.map(toDeliveryOrder);
}
