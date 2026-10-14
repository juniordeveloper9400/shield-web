import { api } from '@/lib/api';
import { fromEnum } from '@/lib/mappers';
import type {
  FulfillmentType,
  OrderStatus,
  PaymentStatus,
  Prescription,
  PrescriptionImage,
  PrescriptionMedicine,
  PrescriptionMedicineInput,
  PrescriptionStatus,
} from '@/types';

const DURATION_LABEL: Record<string, string> = {
  ONE_WEEK: '1 week',
  FIFTEEN_DAYS: '15 days',
  ONE_MONTH: '1 month',
  TWO_MONTHS: '2 months',
  THREE_MONTHS: '3 months',
};

function durationLabel(customDays: number, duration: string | null): string {
  if (customDays > 0) return `${customDays} days`;
  return duration ? DURATION_LABEL[duration] ?? '—' : '—';
}

/** A `GET /v1/staff/prescriptions[/:id]` row — several numerics/ids come
 *  back as JSON numbers (bigint columns), not the string ids shieldweb's
 *  own types use; mapped below. */
interface PrescriptionApiRow {
  id: number;
  uuid: string;
  memberId: number;
  patientId: number;
  storeId: number | null;
  code: string;
  fileName: string;
  doctor: string;
  duration: string | null;
  customDays: number | null;
  status: string;
  createdAt: string;
  memberName: string;
  memberPhone: string;
  patientName: string;
  storeCode: string;
  storeName: string;
  images: { id: string; image: string; rotation: number }[];
  linkedOrderId: number | null;
  orderFulfillmentType: string;
  orderStatus: string | null;
  orderReviewedAt: string | null;
  orderStoreContactedAt: string | null;
  orderConvertedToBillAt: string | null;
  billAmount: string | number;
  billStatus: string;
  medicines: {
    name: string;
    pack: string;
    doseMorning: number;
    doseAfternoon: number;
    doseNight: number;
    totalUnits: number;
    routeTime: string;
    status: string;
  }[];
}

function toMedicine(r: PrescriptionApiRow['medicines'][number]): PrescriptionMedicine {
  return {
    name: r.name,
    pack: r.pack,
    doseMorning: r.doseMorning,
    doseAfternoon: r.doseAfternoon,
    doseNight: r.doseNight,
    totalUnits: r.totalUnits,
    routeTime: r.routeTime,
    status: fromEnum(r.status),
  };
}

function toPrescription(r: PrescriptionApiRow): Prescription {
  return {
    id: String(r.id),
    code: r.code,
    memberId: String(r.memberId),
    memberName: r.memberName,
    memberPhone: r.memberPhone,
    patientId: String(r.patientId),
    patientName: r.patientName,
    doctor: r.doctor,
    fileName: r.fileName,
    images: r.images as PrescriptionImage[],
    duration: durationLabel(r.customDays ?? 0, r.duration),
    durationToken: r.duration ? fromEnum(r.duration) : '',
    customDays: r.customDays ?? 0,
    status: fromEnum<PrescriptionStatus>(r.status),
    storeId: r.storeId == null ? '' : String(r.storeId),
    storeCode: r.storeCode,
    storeName: r.storeName,
    createdAt: r.createdAt,
    medicines: r.medicines.map(toMedicine),
    orderId: r.linkedOrderId == null ? '' : String(r.linkedOrderId),
    fulfillmentType: fromEnum<FulfillmentType>(r.orderFulfillmentType),
    billAmount: Number(r.billAmount),
    billStatus: fromEnum<PaymentStatus>(r.billStatus),
    orderStatus: r.orderStatus == null ? 'processing' : fromEnum<OrderStatus>(r.orderStatus),
    orderReviewedAt: r.orderReviewedAt ?? '',
    orderStoreContactedAt: r.orderStoreContactedAt ?? '',
    orderConvertedToBillAt: r.orderConvertedToBillAt ?? '',
  };
}

/** Every uploaded prescription, across every branch and member this role
 *  may see. Reads through backend/api's staff prescription routes now,
 *  not Neon directly. */
export async function listPrescriptions(token: string | null): Promise<Prescription[]> {
  const rows = await api.get<PrescriptionApiRow[]>('/v1/staff/prescriptions', token);
  return rows.map(toPrescription);
}

/**
 * One member's own prescriptions — the same rows {@link listPrescriptions}
 * would show for them, filtered client-side (the backend route itself has
 * no member filter; the console's own list is small enough that this is
 * one request either way). Used by the "Prescriptions" tab on the user
 * detail page.
 */
export async function listPrescriptionsForMember(memberId: string, token: string | null): Promise<Prescription[]> {
  const all = await listPrescriptions(token);
  return all.filter((p) => p.memberId === memberId);
}

/**
 * The medicines on whichever prescription [orderId] was billed against —
 * `BillEditorModal`'s source for offering a prescription order's real
 * intake list as bill-line candidates instead of a blank form. Null when
 * [orderId] has no linked prescription at all (a standard order, or a
 * gap); an empty array when it does but nothing was ever added to its
 * intake card.
 */
export async function getPrescriptionMedicinesForOrder(
  orderId: string,
  token: string | null,
): Promise<PrescriptionMedicine[] | null> {
  const rows = await api.get<PrescriptionApiRow['medicines'] | null>(
    `/v1/staff/orders/${orderId}/prescription-medicines`,
    token,
  );
  return rows === null ? null : rows.map(toMedicine);
}

export async function setPrescriptionStatus(id: string, status: PrescriptionStatus, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/prescriptions/${id}/status`, { status: status.toUpperCase() }, token);
}

/**
 * Corrects what the member sent up front — the doctor's name (blank until a
 * reviewer reads it off the script) and how long the course runs, either one
 * of the five fixed spans or a reviewer's own day count. [customDays] above
 * 0 is what [Prescription.duration] actually displays; 0 clears it back to
 * plain [durationToken].
 */
export async function updatePrescriptionDetails(
  id: string,
  opts: { doctor: string; durationToken: string; customDays: number },
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/prescriptions/${id}/details`, opts, token);
}

/**
 * Pins (or clears) the branch this prescription is filled at —
 * overriding the pickup-order / home-branch fallback {@link listPrescriptions}
 * otherwise falls back to for [Prescription.storeCode] / [Prescription.storeName].
 * `null` clears it back to that fallback chain.
 */
export async function updatePrescriptionBranch(id: string, storeId: string | null, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/prescriptions/${id}/branch`, { storeId: storeId === null ? null : Number(storeId) }, token);
}

/**
 * Admin removal of a prescription (soft delete), the same soft delete the
 * member's own Delete does — but not subject to the member's lock, since the
 * store may remove a script at any stage. Its order, if any, is untouched:
 * cancel that separately. Returns false when it was already gone.
 */
export async function deletePrescription(id: string, token: string | null): Promise<boolean> {
  const result = await api.delete<{ deleted: boolean }>(`/v1/staff/prescriptions/${id}`, token);
  return result.deleted;
}

/**
 * Sets how this prescription's order reaches the member — home delivery or
 * store pickup. The member's own choice at checkout is the default; this is
 * the reviewer's override. Only an order still being processed can change:
 * once it is out for delivery, delivered or cancelled the way it reached
 * the member is a fact, not a plan. Returns false when there was no such
 * order to change.
 */
export async function updatePrescriptionFulfillment(
  id: string,
  fulfillmentType: 'HOME_DELIVERY' | 'STORE_PICKUP',
  token: string | null,
): Promise<boolean> {
  const result = await api.patch<{ changed: boolean }>(`/v1/staff/prescriptions/${id}/fulfillment`, { fulfillmentType }, token);
  return result.changed;
}

/**
 * Re-points this prescription at a different saved patient of the same
 * member — for when the wrong family member was picked at upload, or the
 * right one hadn't been added yet. The picker this feeds only ever offers
 * that member's own patients (or a freshly created one); the server
 * verifies [patientId] against the prescription's own member regardless.
 */
export async function updatePrescriptionPatient(id: string, patientId: string, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/prescriptions/${id}/patient`, { patientId: Number(patientId) }, token);
}

/**
 * Fixes one image's display rotation (a script photographed sideways or
 * upside down is common enough to need this) — permanently, not just for
 * the reviewer's own look. [imageId] is one row of `app.prescription_image`
 * (migration 0040), or a `legacy-<id>` id for a pre-migration photo stored
 * directly on `app.prescription` instead.
 */
export async function setPrescriptionImageRotation(
  imageId: string,
  degrees: 0 | 90 | 180 | 270,
  prescriptionId: string,
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/prescriptions/${prescriptionId}/images/${imageId}/rotation`, { rotation: degrees }, token);
}

/**
 * Replaces a prescription's intake card with the lines the pharmacist
 * entered and moves the row to READ — the customer app picks the card up
 * on its next read and expands it. Blank rows (no name) are dropped;
 * sending an empty list clears the card and leaves the row at whatever
 * status it was.
 */
export async function savePrescriptionIntake(
  id: string,
  medicines: PrescriptionMedicineInput[],
  token: string | null,
): Promise<void> {
  await api.post(`/v1/staff/prescriptions/${id}/intake`, { medicines }, token);
}

/**
 * Admin recovery only — not the normal path. Every prescription is meant
 * to already carry the `app."order"` (kind `PRESCRIPTION`) the member's own
 * checkout created alongside it; this exists for the rare one that somehow
 * doesn't, so "Convert to bill" has something to convert instead of
 * refusing outright. Uses exactly the fields already confirmed right there
 * on the Details step — the member, the pinned branch, the fulfilment type
 * shown — rather than inventing anything a reviewer hasn't already set.
 * Returns the new order's id.
 */
export async function createOrderForPrescription(
  prescriptionId: string,
  fulfillmentType: 'HOME_DELIVERY' | 'STORE_PICKUP',
  token: string | null,
): Promise<string> {
  const result = await api.post<{ id: number }>(`/v1/staff/prescriptions/${prescriptionId}/order`, { fulfillmentType }, token);
  return String(result.id);
}
