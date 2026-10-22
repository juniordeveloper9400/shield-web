import { api } from '@/lib/api';
import type { LabOrderDetailsInput } from '@/lib/labOrderDetails';
import { fromEnum } from '@/lib/mappers';
import { HIDDEN_TEST_LABEL } from '@/types';
import type {
  LabBooking,
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
  memberId: number;
  contactName?: string;
  contactPhone?: string;
  labPackageId: number | null;
  storeId: number | null;
  memberName: string | null;
  memberPhone: string | null;
  packageName: string | null;
  testHidden?: boolean;
  storeCode: string | null;
  storeName: string | null;
  patientsCount: number;
  patients: {
    id: number;
    patientId: number | null;
    name: string;
    age: number | null;
    phone?: string;
    dob?: string;
    gender?: string;
    relation?: string;
    abhaId?: string;
    address: string;
    addressId: number | null;
    addressOverride: string | null;
  }[];
  fulfillmentType: string;
  address: string;
  addressPhone: string | null;
  assignedStaffId: number | null;
  assignedStaffName: string | null;
  unitPrice: string | number;
  fixCharge?: string | number;
  fuelCharge?: string | number;
  techFee?: string | number;
  isVerified?: boolean;
  totalPrice: string | number;
  status: string;
  scheduledFor: string | null;
  note: string | null;
  reportPages: number;
  reportUploadedAt: string | null;
  createdAt: string;
  billImage: string | null;
  billNumber?: string | null;
  billAmount: string | number;
  billDiscount: string | number;
  billStatus: string;
  billWalletCollected: string | number;
  billCashCollected: string | number;
  billGpayCollected?: string | number;
  healthPassApplied?: boolean;
  healthPassTier?: string | null;
  orderGroupId?: string | null;
}

function toLabBooking(r: LabBookingApiRow): LabBooking {
  return {
    id: String(r.id),
    code: r.code ?? `LB-${String(r.id).padStart(4, '0')}`,
    memberId: String(r.memberId),
    contactName: r.contactName ?? r.memberName ?? '',
    contactPhone: r.contactPhone ?? r.memberPhone ?? '',
    labPackageId: r.labPackageId == null ? '' : String(r.labPackageId),
    storeId: r.storeId == null ? '' : String(r.storeId),
    memberName: r.memberName ?? '—',
    memberPhone: r.memberPhone ?? '',
    packageName: r.testHidden ? HIDDEN_TEST_LABEL : r.packageName ?? '—',
    testHidden: r.testHidden === true,
    storeCode: r.storeCode ?? '',
    storeName: r.storeName ?? '',
    patientsCount: r.patientsCount ?? (r.patients?.length || 1),
    patients: (r.patients ?? []).map((p) => ({
      id: String(p.id),
      patientId: p.patientId == null ? null : String(p.patientId),
      name: p.name,
      age: p.age,
      phone: p.phone ?? '',
      dob: p.dob ?? '',
      gender: p.gender ?? '',
      relation: p.relation ?? '',
      abhaId: p.abhaId ?? '',
      address: p.address ?? '',
      addressId: p.addressId == null ? null : String(p.addressId),
      addressOverride: p.addressOverride ?? '',
    })),
    fulfillmentType: fromEnum<LabFulfillmentType>(r.fulfillmentType || 'home_collection'),
    address: r.address ?? '',
    addressPhone: r.addressPhone ?? '',
    assignedStaffId: r.assignedStaffId == null ? '' : String(r.assignedStaffId),
    assignedStaffName: r.assignedStaffName ?? '',
    unitPrice: Number(r.unitPrice || 0),
    fixCharge: Number(r.fixCharge || 0),
    // The backend strips the [BILL_VERIFIED] tag out of `note` and returns it
    // as these three fields — without them a verified bill read as
    // "Unverified" again after every reload.
    fuelCharge: Number(r.fuelCharge || 0),
    techFee: Number(r.techFee || 0),
    isVerified: r.isVerified === true,
    totalPrice: Number(r.totalPrice || 0),
    status: fromEnum<LabBookingStatus>(r.status || 'requested'),
    scheduledFor: r.scheduledFor ?? '',
    note: r.note ?? '',
    reportPages: r.reportPages ?? 0,
    reportUploadedAt: r.reportUploadedAt ?? '',
    createdAt: r.createdAt ?? '',
    billImage: r.billImage ?? '',
    billNumber: r.billNumber ?? '',
    billAmount: Number(r.billAmount || 0),
    billDiscount: Number(r.billDiscount || 0),
    billStatus: fromEnum<PaymentStatus>(r.billStatus || 'pending'),
    billWalletCollected: Number(r.billWalletCollected || 0),
    billCashCollected: Number(r.billCashCollected || 0),
    billGpayCollected: Number(r.billGpayCollected || 0),
    healthPassApplied: r.healthPassApplied === true,
    healthPassTier: r.healthPassTier ?? '',
    orderGroupId: r.orderGroupId ?? null,
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

/** One member's own lab bookings, newest first — the User detail page's
 *  own Orders tab. Client-filtered off the same staff list every other lab
 *  screen reads, same pattern `listPrescriptionsForMember` already uses. */
export async function listLabBookingsForMember(memberId: string, token: string | null): Promise<LabBooking[]> {
  const all = await listLabBookings(token);
  return all.filter((b) => b.memberId === memberId);
}

/** The four Health Pass figures `WalletBreakdown` shows for a lab booking's member — same shape `getWalletPreview` returns for a regular order. */
export interface LabWalletPreview {
  balance: number;
  availableAllowance: number;
  monthlyRedeemable: number;
  redeemedThisMonth: number;
}

/**
 * The member's wallet preview for this booking, read-only — same shape
 * `getWalletPreview` (orders) returns via `billPayments.ts`'s helpers. Lets
 * the bill panel show what collecting would actually draw before committing
 * to anything.
 */
export async function getWalletPreviewForLabBooking(bookingId: string, token: string | null): Promise<LabWalletPreview> {
  return api.get<LabWalletPreview>(`/v1/staff/lab-bookings/${bookingId}/wallet-balance`, token);
}

/**
 * The fixed Health Pass home-collection rate for this booking (Silver ₹50,
 * Gold ₹20, Platinum free for its first 6 lifetime visits), if the member
 * applied their coupon at checkout. `locked: false` means there is nothing
 * to preload — no coupon applied, an unrecognised tier, or a Platinum
 * member who has used all 6 free visits — and the order editor falls back
 * to its normal fuel/technician-charge inputs.
 */
export interface LabHealthPassCharge {
  applied: boolean;
  tier: 'silver' | 'gold' | 'platinum' | string | null;
  locked: boolean;
  fixedCharge: number;
  platinumUsed: number | null;
  platinumRemaining: number | null;
  platinumTotal: number | null;
}

export async function getHealthPassChargeForLabBooking(
  bookingId: string,
  token: string | null,
): Promise<LabHealthPassCharge> {
  return api.get<LabHealthPassCharge>(`/v1/staff/lab-bookings/${bookingId}/health-pass-charge`, token);
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
  opts: { image: string; discountAmount: number; billNumber?: string },
  token: string | null,
): Promise<void> {
  await api.put(`/v1/staff/lab-bookings/${id}/bill`, opts, token);
}

/**
 * Settles a sent-and-priced lab bill — the collection half of the same
 * OTP flow `collectBillWithWallet` (orders/prescriptions) uses: the member
 * reads back the code MSG91 texted them, staff verifies it client-side
 * (`confirmDeliveryOtp`), and only on that success does this get called.
 * `PATCH /v1/staff/lab-bookings/:id/collect-wallet`
 * (`BookingService.collectLabBillWithWallet`) — see that method's own doc.
 */
export async function collectLabBillWithWallet(
  id: string,
  token: string | null,
): Promise<
  { ok: true; walletAmount: number; cashAmount: number; settled: boolean } | { ok: false; reason: string }
> {
  return api.patch(`/v1/staff/lab-bookings/${id}/collect-wallet`, undefined, token);
}

/**
 * Records GPay and/or cash the counter takes against a lab bill after the
 * wallet step — the lab twin of `receiveBillPayment` (orders). The server
 * refuses more than is still owed and marks the bill PAID once covered.
 * `PATCH /v1/staff/lab-bookings/:id/receive`.
 */
export async function receiveLabBillPayment(
  id: string,
  amounts: { cash: number; gpay: number },
  token: string | null,
): Promise<{ ok: true; settled: boolean; remaining: string } | { ok: false; reason: string }> {
  return api.patch(`/v1/staff/lab-bookings/${id}/receive`, amounts, token);
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
 * the member, plus (since migration 0095) its branch, collection address and
 * patients. A blank date clears the schedule. Cancelled bookings, and dates
 * on a finished (Report ready) one, are left alone server-side.
 *
 * `storeId`/`address`/`patients` are each omitted when unchanged — the
 * server leaves whatever's already on record alone rather than clearing it.
 * Editing patients recomputes the booking's total server-side from the new
 * headcount (unit price × count) — never a number typed here.
 */
export async function updateLabBookingDetails(
  id: string,
  input: Omit<Partial<LabOrderDetailsInput>, 'patients'> & {
    scheduledFor: string | null;
    note: string;
    storeId?: number;
    address?: string;
    patients?: {
      bookingPatientId?: number;
      patientId?: number;
      name?: string;
      age?: number;
      phone?: string;
      dob?: string;
      gender?: string;
      relation?: string;
      abhaId?: string;
      addressId?: number | null;
      addressOverride?: string | null;
    }[];
  },
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/lab-bookings/${id}/details`, input, token);
}

/** A LAB_TECHNICIAN-role staff account — who a home-collection booking's
 *  sample can be assigned to. Same shape as `deliveries.ts`'s DeliveryBoy. */
export interface LabStaff {
  id: string;
  name: string;
  storeCode: string;
}

interface LabStaffApiRow {
  id: number;
  name: string;
  storeCode: string | null;
}

/** Lab staff at one branch (or every branch when [storeCode] is omitted —
 *  a Super Admin/Admin/Lab Admin's assignment picker, which isn't store-
 *  bound). `GET /v1/staff/lab-staff`. */
export async function listLabStaff(storeCode: string | undefined, token: string | null): Promise<LabStaff[]> {
  const path = storeCode ? `/v1/staff/lab-staff?storeCode=${encodeURIComponent(storeCode)}` : '/v1/staff/lab-staff';
  const rows = await api.get<LabStaffApiRow[]>(path, token);
  return rows.map((r) => ({ id: String(r.id), name: r.name, storeCode: r.storeCode ?? '' }));
}

/**
 * Assigns (or clears, passing null) who collects a home-collection booking's
 * sample. The server refuses a LAB_TECHNICIAN caller handing a booking to
 * anyone but themselves — see `BookingService.assignLabStaff`'s own doc. A
 * home-collection booking cannot be confirmed until this is set.
 */
export async function assignLabStaff(id: string, staffId: string | null, token: string | null): Promise<void> {
  await api.patch(
    `/v1/staff/lab-bookings/${id}/staff`,
    { staffId: staffId === null ? null : Number(staffId) },
    token,
  );
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
