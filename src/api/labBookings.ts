import { api } from '@/lib/api';
import { fromEnum } from '@/lib/mappers';
import type {
  LabBooking,
  LabBookingPatient,
  LabBookingStatus,
  LabFulfillmentType,
  LabReportPage,
  PaymentStatus,
} from '@/types';

/** A `GET /v1/staff/lab-bookings` row — several ids/numerics come back as
 *  JSON numbers or numeric strings (bigint/numeric columns), not the
 *  string/number shape {@link LabBooking} needs; mapped below. */
interface LabBookingApiRow {
  id: number;
  code: string;
  memberName: string | null;
  memberPhone: string | null;
  packageName: string | null;
  storeCode: string | null;
  storeName: string | null;
  patientsCount: number;
  patients: { name: string; age: number | null }[];
  fulfillmentType: string;
  address: string;
  addressPhone: string | null;
  unitPrice: string | number;
  totalPrice: string | number;
  status: string;
  scheduledFor: string | null;
  note: string | null;
  reportPages: number;
  reportUploadedAt: string | null;
  createdAt: string;
  billImage: string | null;
  billAmount: string | number;
  billDiscount: string | number;
  billStatus: string;
  billWalletCollected: string | number;
  billCashCollected: string | number;
}

function toLabBooking(r: LabBookingApiRow): LabBooking {
  return {
    id: String(r.id),
    code: r.code,
    memberName: r.memberName ?? '—',
    memberPhone: r.memberPhone ?? '',
    packageName: r.packageName ?? '—',
    storeCode: r.storeCode ?? '',
    storeName: r.storeName ?? '',
    patientsCount: r.patientsCount,
    patients: r.patients as LabBookingPatient[],
    fulfillmentType: fromEnum<LabFulfillmentType>(r.fulfillmentType),
    address: r.address,
    addressPhone: r.addressPhone ?? '',
    unitPrice: Number(r.unitPrice),
    totalPrice: Number(r.totalPrice),
    status: fromEnum<LabBookingStatus>(r.status),
    scheduledFor: r.scheduledFor ?? '',
    note: r.note ?? '',
    reportPages: r.reportPages,
    reportUploadedAt: r.reportUploadedAt ?? '',
    createdAt: r.createdAt,
    billImage: r.billImage ?? '',
    billAmount: Number(r.billAmount),
    billDiscount: Number(r.billDiscount),
    billStatus: fromEnum<PaymentStatus>(r.billStatus),
    billWalletCollected: Number(r.billWalletCollected),
    billCashCollected: Number(r.billCashCollected),
  };
}

/**
 * Member lab-test bookings, newest first. Reads through backend/api's
 * staff booking routes now, not Neon directly — same store-scoping every
 * other staff lab-booking route already applies.
 *
 * Report pages are only *counted* here — each is a large image, fetched one
 * booking at a time by [listLabReportPages] when its Manage window opens.
 */
export async function listLabBookings(token: string | null): Promise<LabBooking[]> {
  const rows = await api.get<LabBookingApiRow[]>('/v1/staff/lab-bookings', token);
  return rows.map(toLabBooking);
}

/**
 * The member's wallet balance for the booking's own member, read-only — same
 * shape as {@link getWalletBalanceForOrder} in `billPayments.ts`. Lets the
 * bill panel show what collecting would actually draw before committing to
 * anything.
 */
export async function getWalletBalanceForLabBooking(bookingId: string, token: string | null): Promise<number> {
  const result = await api.get<{ balance: number }>(`/v1/staff/lab-bookings/${bookingId}/wallet-balance`, token);
  return result.balance;
}

/**
 * Prices a booking's bill — the "Convert to bill" step's own save, through
 * `backend/api` (`PUT /v1/staff/lab-bookings/:id/bill`,
 * `BookingService.sendLabBill`) rather than raw SQL: unlike a prescription's
 * bill, there is no per-line picker here for a browser-side write to save
 * time on — the backend prices the one line itself from the booking's own
 * package/unit price, net of `discountAmount`.
 */
export async function sendLabBookingBill(
  id: string,
  opts: { image: string; discountAmount: number },
  token: string | null,
): Promise<void> {
  await api.put(`/v1/staff/lab-bookings/${id}/bill`, opts, token);
}

/**
 * Settles a sent-and-priced lab bill — the collection half of the same
 * OTP flow `collectBillWithWallet` (orders/prescriptions) uses: the member
 * reads back the code Firebase texted them, staff verifies it client-side
 * (`confirmDeliveryOtp`), and only on that success does this get called.
 * `PATCH /v1/staff/lab-bookings/:id/collect-wallet`
 * (`BookingService.collectLabBillWithWallet`) — see that method's own doc.
 */
export async function collectLabBillWithWallet(
  id: string,
  token: string | null,
): Promise<
  { ok: true; walletAmount: number; cashAmount: number } | { ok: false; reason: string }
> {
  return api.patch(`/v1/staff/lab-bookings/${id}/collect-wallet`, undefined, token);
}

/**
 * Moves a booking to [status]. "Report ready" is refused unless at least one
 * report page is attached — the member is told a report is waiting, so it
 * must be — enforced server-side (`ConflictException`), not just by a
 * disabled button. The server also now enforces the legal step order
 * (requested → confirmed → sample collected → report ready, or cancel from
 * any non-terminal state) — the same linear progression this console's own
 * UI already only ever offers.
 */
export async function setLabBookingStatus(
  id: string,
  status: LabBookingStatus,
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/lab-bookings/${id}/status`, { status: status.toUpperCase() }, token);
}

/**
 * The lab's edit of a booking: when it is scheduled for and the note shown to
 * the member. A blank date clears the schedule. Cancelled bookings, and
 * dates on a finished (Report ready) one, are left alone server-side.
 */
export async function updateLabBookingDetails(
  id: string,
  input: { scheduledFor: string | null; note: string },
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/lab-bookings/${id}/details`, input, token);
}

/** The pages of one booking's report, in order. Heavy — call it per booking. */
export async function listLabReportPages(id: string, token: string | null): Promise<LabReportPage[]> {
  return api.get<LabReportPage[]>(`/v1/staff/lab-bookings/${id}/report-pages`, token);
}

/**
 * Attaches [pages] (already resized to JPEG data URIs) after the ones already
 * there, and stamps when the report was last touched.
 */
export async function addLabReportPages(
  id: string,
  pages: { name: string; image: string }[],
  token: string | null,
): Promise<void> {
  if (pages.length === 0) return;
  await api.post(`/v1/staff/lab-bookings/${id}/report-pages`, { pages }, token);
}

/**
 * Removes one report page. A booking already marked Report ready keeps its
 * last page — the server refuses to take it, so the member is never left
 * with a "ready" report that is empty.
 */
export async function removeLabReportPage(bookingId: string, pageId: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/lab-bookings/${bookingId}/report-pages/${pageId}`, token);
}
