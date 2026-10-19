import { LabOrderDetailsEditor } from './LabOrderDetailsEditor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { WalletBreakdown } from '@/components/orders/WalletBreakdown';
import { telHref, whatsappHref } from '@/lib/contactLinks';
import { formatCurrency, formatDateTime, toneForStatus } from '@/lib/format';
import { fileToResizedDataUrl } from '@/lib/images';
import {
  confirmDeliveryOtp,
  describeOtpError,
  sendDeliveryOtp,
  type OtpConfirmation,
} from '@/lib/msg91Otp';
import {
  MAX_REPORT_PAGES,
  canAttachReport,
  canBillBooking,
  canEditBookingDetails,
  canEditNote,
  canRemoveReportPage,
  canReschedule,
  fromLocalInput,
  nextStepBlocker,
  reportFilesProblem,
  toLocalInput,
} from '@/lib/labBooking';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useConfirmDialog } from '@/lib/useConfirmDialog';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'The request failed.';
}
import {
  addLabReportPages,
  assignLabStaff,
  collectLabBillWithWallet,
  getWalletPreviewForLabBooking,
  listLabReportPages,
  listLabStaff,
  removeLabReportPage,
  sendLabBookingBill,
  setLabBookingStatus,
  updateLabBookingDetails,
} from '@/api/labBookings';
import { listStores } from '@/api/stores';
import type { LabBooking, LabBookingStatus, LabReportPage } from '@/types';

const STATUS_LABEL: Record<LabBookingStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  sample_collected: 'Sample collected',
  report_ready: 'Report ready',
  cancelled: 'Cancelled',
};

const NEXT: Record<LabBookingStatus, LabBookingStatus | null> = {
  requested: 'confirmed',
  confirmed: 'sample_collected',
  sample_collected: 'report_ready',
  report_ready: null,
  cancelled: null,
};

const NEXT_LABEL: Record<LabBookingStatus, string> = {
  requested: 'Confirm',
  confirmed: 'Sample collected',
  sample_collected: 'Report ready',
  report_ready: '',
  cancelled: '',
};

const inputClass =
  'w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400';

/**
 * The Lab Admin's window on one booking: who it is for and where, a Call /
 * WhatsApp shortcut to the member, the schedule and a note to the member, the
 * report pages, and the next step in the process.
 *
 * Mounted per booking (keyed by id) so its form state always starts from the
 * booking that was opened; every write calls [onChanged] so the list behind
 * reloads and this window is handed the fresh row.
 */
export function LabBookingModal({
  booking,
  onClose,
  onChanged,
  autoCollect = false,
}: {
  booking: LabBooking | null;
  onClose: () => void;
  onChanged: () => void;
  /** Skip straight to the OTP collection step on open — Lab Bills' own
   *  hand-off from a booking just converted there via "Convert to bill →",
   *  not a plain "Manage" click on an already-billed row. See that page's
   *  own doc. */
  autoCollect?: boolean;
}) {
  if (!booking) return null;
  return (
    <BookingWindow
      key={booking.id}
      booking={booking}
      onClose={onClose}
      onChanged={onChanged}
      autoCollect={autoCollect}
    />
  );
}

function BookingWindow({
  booking,
  onClose,
  onChanged,
  autoCollect,
}: {
  booking: LabBooking;
  onClose: () => void;
  onChanged: () => void;
  autoCollect: boolean;
}) {
  const { accessToken, user } = useAuth();
  const [editingOrder, setEditingOrder] = useState(false);
  const [inlineBusy, setInlineBusy] = useState(false);
  const [inlineVersion, setInlineVersion] = useState(0);
  const fullOrderEditor = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'lab';
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState(toLocalInput(booking.scheduledFor));
  const [note, setNote] = useState(booking.note);
  // ---- Editable branch / collection address / patients (migration 0095) —
  // bundled into the same "Booking details" save as schedule/note below.
  const [storeCode, setStoreCode] = useState(booking.storeCode);
  const [address, setAddress] = useState(booking.address);
  const [patients, setPatients] = useState(
    booking.patients.map((p) => ({
      bookingPatientId: p.id ? Number(p.id) : undefined,
      patientId: p.patientId == null ? undefined : Number(p.patientId),
      name: p.name,
      age: p.age == null ? '' : String(p.age),
      // The raw override text, edited directly — blank means "use the
      // booking's own address", shown as this row's placeholder below.
      addressOverride: p.addressOverride,
      addressId: p.addressId,
      resolvedAddress: p.address,
    })),
  );
  const [patientsError, setPatientsError] = useState<string | null>(null);
  const stores = useAsync(() => listStores(accessToken), [accessToken]);
  // Every branch still open for lab collection, plus the booking's own
  // current branch even if it's since been switched off — so the dropdown
  // never silently drops the value already on the booking.
  const labStores = useMemo(() => {
    const all = stores.data ?? [];
    const eligible = all.filter((s) => s.offersLabCollection && s.isActive);
    if (eligible.some((s) => s.code === booking.storeCode)) return eligible;
    const current = all.find((s) => s.code === booking.storeCode);
    return current ? [current, ...eligible] : eligible;
  }, [stores.data, booking.storeCode]);

  // ---- Assigned staff (migration 0095) — its own immediate-save control,
  // not bundled into "Save changes": the same pattern DeliveriesPage's
  // delivery-boy dropdown uses, since it's one field with its own endpoint
  // rather than part of the batched details write.
  const homeCollection = booking.fulfillmentType === 'home_collection';
  const labStaff = useAsync(
    () => (homeCollection ? listLabStaff(booking.storeCode || undefined, accessToken) : Promise.resolve([])),
    [homeCollection, booking.storeCode, accessToken],
  );
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  async function onAssignStaff(staffId: string) {
    setStaffBusy(true);
    setStaffError(null);
    try {
      await assignLabStaff(booking.id, staffId || null, accessToken);
      onChanged();
    } catch (err) {
      setStaffError(errorMessage(err));
    } finally {
      setStaffBusy(false);
    }
  }
  const [pages, setPages] = useState<LabReportPage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(booking.reportPages > 0);
  const [busy, setBusy] = useState<'status' | 'details' | 'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const [preview, setPreview] = useState<LabReportPage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const status = booking.status;
  const closed = status === 'cancelled';

  // ---- Once the report is ready, there's nothing left to actually do
  // except bill the member — Schedule & note and Lab report stay fully
  // capable (a lab tech can still fix a typo or swap a blurry page; see
  // canEditNote/canAttachReport/canRemoveReportPage's own docs, all
  // deliberately still true past report_ready), but collapse into a
  // one-line summary by default so Billing's "Convert to bill" reads as
  // the one thing left to do, not one of three open sections. Either can
  // still be expanded back open by hand; the effect below only fires the
  // moment a booking actually becomes report_ready, so it never fights an
  // admin who reopened one to make that fix.
  const [scheduleOpen, setScheduleOpen] = useState(status !== 'report_ready');
  const [reportOpen, setReportOpen] = useState(status !== 'report_ready');
  useEffect(() => {
    if (status === 'report_ready') {
      setScheduleOpen(false);
      setReportOpen(false);
    }
  }, [status]);

  // ---- Billing: same "Convert to bill, then collect from the wallet under
  // an OTP" flow a prescription/standard order gets (BillEditorModal), sized
  // down to what a lab booking actually needs — its price is already fixed
  // at booking time, so there's no line-item picker, just a discount and an
  // optional photo of the paper invoice. See labBookings.ts's own doc on
  // sendLabBookingBill/collectLabBillWithWallet.
  const billed = booking.billAmount > 0;
  const [billDiscount, setBillDiscount] = useState(booking.billDiscount || 0);
  const [billImage, setBillImage] = useState(booking.billImage);
  const [billBusy, setBillBusy] = useState(false);
  const [billError, setBillError] = useState<string | null>(null);
  const [billImageBusy, setBillImageBusy] = useState(false);
  const billFileInput = useRef<HTMLInputElement>(null);
  const netTotal = Math.max(booking.totalPrice - billDiscount, 0);

  const { data: walletPreview } = useAsync(
    () => getWalletPreviewForLabBooking(booking.id, accessToken),
    [booking.id, accessToken],
  );
  const walletBalance = walletPreview?.balance;

  async function onPickBillImage(file: File | null) {
    if (billFileInput.current) billFileInput.current.value = '';
    if (!file) return;
    setBillImageBusy(true);
    try {
      setBillImage(await fileToResizedDataUrl(file, 1600, 0.8));
    } catch (err) {
      setBillError(err instanceof Error ? err.message : 'Could not read that photo.');
    } finally {
      setBillImageBusy(false);
    }
  }

  async function sendBill() {
    setBillBusy(true);
    setBillError(null);
    try {
      await sendLabBookingBill(booking.id, { image: billImage, discountAmount: billDiscount }, accessToken);
      onChanged();
      if (billed) {
        // Already billed — this was "Update bill" (a discount/photo fix
        // before collecting), not a first conversion. Already exactly
        // where collection happens, so go straight into it in place.
        void startCollection();
      } else {
        // First conversion, from Lab Orders — "Convert to bill" hands the
        // booking off to Lab Bills, the same way pricing/collecting a
        // standard order's bill happens on its own page, not the order
        // review it started from. Closing here, not just navigating, so
        // the Lab Orders list behind doesn't sit stale under a modal the
        // admin no longer needs.
        onClose();
        navigate(`/lab-bills?open=${booking.id}`);
      }
    } catch (err) {
      setBillError(errorMessage(err));
    } finally {
      setBillBusy(false);
    }
  }

  // ---- OTP-gated wallet collection — identical mechanics to
  // BillEditorModal's own (see that file's doc): sendOtp only asks MSG91
  // to text the member's phone a code; verifyAndCollect is the one place
  // that actually calls collectLabBillWithWallet, and only once the backend
  // has confirmed the code staff typed in matches (see lib/msg91Otp.ts).
  const [otpConfirmation, setOtpConfirmation] = useState<OtpConfirmation | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [collected, setCollected] = useState<{ walletAmount: number; cashAmount: number } | null>(
    null,
  );
  const [showOtpPopover, setShowOtpPopover] = useState(false);
  const otpInFlight = useRef(false);
  const otpSession = useRef(0);

  useEffect(() => {
    return () => {
      otpSession.current += 1;
    };
  }, []);

  async function sendOtp() {
    if (otpInFlight.current) return;
    otpInFlight.current = true;
    const session = otpSession.current;
    setOtpBusy(true);
    setOtpError(null);
    setOtpConfirmation(null);
    setOtpCode('');
    try {
      const confirmation = await sendDeliveryOtp(booking.memberPhone);
      if (session !== otpSession.current) return;
      setOtpConfirmation(confirmation);
    } catch (err) {
      if (session !== otpSession.current) return;
      setOtpError(describeOtpError(err));
    } finally {
      otpInFlight.current = false;
      setOtpBusy(false);
    }
  }

  /** Opens the collection panel. Skips the OTP step entirely when the
   *  wallet has nothing to actually cover (`walletCoverage <= 0` — no
   *  balance, no Health Pass allowance left, or both): there is nothing
   *  digital being drawn from the member to verify a code against, so this
   *  just shows a plain "Collect as cash" button — see `collectCashOnly`
   *  below — instead of sending a code nobody needs to read out. */
  async function startCollection() {
    setShowOtpPopover(true);
    if (walletCoverage <= 0) return;
    await sendOtp();
  }

  /** The no-wallet-involved path `startCollection` opens into: calls the
   *  same `collectLabBillWithWallet` endpoint directly (it draws `0` from
   *  the wallet and marks the bill paid against cash collected at the
   *  counter — identical to what a real OTP collection would do here when
   *  the wallet has nothing to give), just without ever sending a code. */
  async function collectCashOnly() {
    if (otpInFlight.current) return;
    otpInFlight.current = true;
    setOtpBusy(true);
    setOtpError(null);
    try {
      const result = await collectLabBillWithWallet(booking.id, accessToken);
      if (!result.ok) {
        setOtpError(result.reason);
        return;
      }
      setCollected({ walletAmount: result.walletAmount, cashAmount: result.cashAmount });
      onChanged();
    } catch (err) {
      setOtpError(describeOtpError(err));
    } finally {
      otpInFlight.current = false;
      setOtpBusy(false);
    }
  }

  async function verifyAndCollect() {
    if (otpInFlight.current || !otpConfirmation || !/^\d{6}$/.test(otpCode.trim())) return;
    otpInFlight.current = true;
    const session = otpSession.current;
    setOtpBusy(true);
    setOtpError(null);
    try {
      await confirmDeliveryOtp(otpConfirmation, otpCode, accessToken);
      if (session !== otpSession.current) return;
      setOtpConfirmation(null);
      setOtpCode('');
      const result = await collectLabBillWithWallet(booking.id, accessToken);
      if (!result.ok) {
        setOtpError(result.reason);
        return;
      }
      setCollected({ walletAmount: result.walletAmount, cashAmount: result.cashAmount });
      onChanged();
    } catch (err) {
      setOtpError(describeOtpError(err));
    } finally {
      otpInFlight.current = false;
      setOtpBusy(false);
    }
  }

  const effectivePaid = collected !== null || booking.billStatus === 'paid';
  const walletCoverage = Math.min(walletBalance ?? 0, billed ? booking.billAmount : netTotal);
  const cashOwed = Math.max((billed ? booking.billAmount : netTotal) - walletCoverage, 0);

  // Lab Bills' own hand-off from "Convert to bill →" (see [autoCollect]'s
  // doc) — the pricing was already filled in and saved to land here, so
  // skip straight to the OTP step instead of showing that same form again.
  // Once, on this booking's first mount only: collecting successfully
  // flips effectivePaid, which must not re-trigger this.
  useEffect(() => {
    if (autoCollect && billed && !effectivePaid) {
      void startCollection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPages() {
    setPagesLoading(true);
    try {
      setPages(await listLabReportPages(booking.id, accessToken));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPagesLoading(false);
    }
  }

  useEffect(() => {
    if (booking.reportPages > 0) void loadPages();
    // Only on open: later changes reload the pages themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleChanged = schedule !== toLocalInput(booking.scheduledFor);
  const noteChanged = note.trim() !== booking.note;
  const storeCodeChanged = storeCode !== booking.storeCode;
  const addressChanged = homeCollection && address.trim() !== booking.address.trim();
  const originalPatients = booking.patients.map((p) => ({
    bookingPatientId: p.id ? Number(p.id) : undefined,
    patientId: p.patientId == null ? undefined : Number(p.patientId),
    name: p.name,
    age: p.age == null ? '' : String(p.age),
    addressOverride: p.addressOverride,
    addressId: p.addressId,
    resolvedAddress: p.address,
  }));
  const patientsChanged = JSON.stringify(patients) !== JSON.stringify(originalPatients);
  const detailsEditable = canEditBookingDetails(status);
  const dirty =
    (canReschedule(status) && scheduleChanged) ||
    (canEditNote(status) && noteChanged) ||
    (detailsEditable && (storeCodeChanged || addressChanged || patientsChanged));

  const isStoreVisit = booking.fulfillmentType === 'store_visit';
  const next = isStoreVisit && status === 'confirmed' ? 'report_ready' : NEXT[status];
  const nextLabel = isStoreVisit && status === 'confirmed' ? 'Report ready' : NEXT_LABEL[status];
  const blocker = nextStepBlocker(status, pages.length || booking.reportPages, booking.fulfillmentType);
  // Mirrors the backend's own STAFF_REQUIRED gate (BookingService.
  // updateLabBookingStatus) — caught here too so the button is disabled with
  // a clear reason instead of a confirm click bouncing off a 409.
  const staffRequiredBlocker =
    next === 'confirmed' && homeCollection && !booking.assignedStaffId
      ? 'Assign a staff member before confirming this home-collection booking.'
      : null;

  function addPatientRow() {
    setPatients((rows) => [
      ...rows,
      { bookingPatientId: undefined, patientId: undefined, name: '', age: '', addressOverride: '', addressId: null, resolvedAddress: '' },
    ]);
  }
  function removePatientRow(i: number) {
    setPatients((rows) => rows.filter((_, idx) => idx !== i));
  }
  function patchPatientRow(i: number, patch: Partial<{ name: string; age: string; addressOverride: string }>) {
    setPatients((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function run<T>(kind: NonNullable<typeof busy>, action: () => Promise<T>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function changeStatus(to: LabBookingStatus) {
    return run('status', () => setLabBookingStatus(booking.id, to, accessToken));
  }

  function saveDetails() {
    setPatientsError(null);
    const cleanedPatients = patients
      .map((p) => ({
        bookingPatientId: p.bookingPatientId,
        patientId: p.patientId,
        name: p.name.trim(),
        age: p.age.trim() ? Number(p.age) : undefined,
        ...(p.age !== (booking.patients.find((old) => Number(old.id) === p.bookingPatientId)?.age?.toString() ?? '') ? { dob: '' } : {}),
        addressId: p.addressId ? Number(p.addressId) : undefined,
        addressOverride: p.addressOverride.trim() || null,
      }))
      .filter((p) => p.name);
    if (patientsChanged && cleanedPatients.length === 0) {
      setPatientsError('At least one patient is required.');
      return Promise.resolve(false);
    }
    const chosenStoreId = storeCodeChanged
      ? labStores.find((s) => s.code === storeCode)?.id
      : undefined;
    return run('details', () =>
      updateLabBookingDetails(booking.id, {
        scheduledFor: canReschedule(status)
          ? fromLocalInput(schedule)
          : booking.scheduledFor || null,
        note,
        ...(chosenStoreId !== undefined ? { storeId: Number(chosenStoreId) } : {}),
        ...(addressChanged ? { address } : {}),
        ...(patientsChanged ? { patients: cleanedPatients } : {}),
      }, accessToken),
    );
  }

  async function onPickFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = '';
    const problem = reportFilesProblem(files, pages.length);
    if (problem) {
      setError(problem);
      return;
    }
    const ok = await run('upload', async () => {
      const resized: { name: string; image: string }[] = [];
      for (const file of files) {
        // Legible at full screen on a phone, small enough to store as text.
        resized.push({ name: file.name, image: await fileToResizedDataUrl(file, 1600, 0.8) });
      }
      await addLabReportPages(booking.id, resized, accessToken);
    });
    if (ok) await loadPages();
  }

  async function removePage(page: LabReportPage) {
    const ok = await run('remove', () => removeLabReportPage(booking.id, page.id, accessToken));
    if (ok) await loadPages();
  }

  const phoneRows = [
    { label: 'Phone', phone: booking.contactPhone ?? booking.memberPhone },
    ...(booking.addressPhone &&
    booking.addressPhone.replace(/\D/g, '').slice(-10) !==
      booking.memberPhone.replace(/\D/g, '').slice(-10)
      ? [{ label: 'Address contact', phone: booking.addressPhone }]
      : []),
  ];

  function closeOrder() {
    if (inlineBusy) return;
    if (!editingOrder) { onClose(); return; }
    ask({ title: 'Discard order changes?', message: 'Your inline edits have not been saved.', confirmLabel: 'Discard changes', danger: true,
      onConfirm: async () => { setEditingOrder(false); onClose(); } });
  }

  return (
    <>
      <Modal
        open
        size="full"
        onClose={closeOrder}
        title={booking.code}
        footer={
          <>
            {fullOrderEditor && editingOrder && <>
              <Button variant="secondary" disabled={inlineBusy} onClick={() => { setInlineVersion(v => v + 1); setEditingOrder(false); }}>Cancel changes</Button>
              <Button form="lab-order-inline-details" type="submit" disabled={inlineBusy}>{inlineBusy ? 'Saving...' : 'Save changes'}</Button>
            </>}
            {status !== 'cancelled' && status !== 'report_ready' && (
              <Button
                variant="danger"
                disabled={busy !== null || editingOrder || inlineBusy}
                onClick={() =>
                  ask({
                    title: 'Cancel this booking?',
                    message: `Booking ${booking.code} for ${booking.memberName} will be cancelled. This cannot be undone.`,
                    confirmLabel: 'Cancel booking',
                    danger: true,
                    onConfirm: async () => {
                      await changeStatus('cancelled');
                    },
                  })
                }
              >
                Cancel booking
              </Button>
            )}
            {next && next !== 'report_ready' && nextLabel !== 'Report ready' && (
              <Button
                variant="primary"
                disabled={busy !== null || editingOrder || inlineBusy || blocker !== null || staffRequiredBlocker !== null || dirty}
                title={
                  blocker ??
                  staffRequiredBlocker ??
                  (dirty ? 'Save your changes to the booking details first.' : undefined)
                }
                onClick={() => void changeStatus(next)}
              >
                {status === 'requested' && <Icon name="check" className="h-4 w-4" />}
                {nextLabel}
              </Button>
            )}
          </>
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <Badge tone={toneForStatus(isStoreVisit && status === 'sample_collected' ? 'confirmed' : status)}>
            {isStoreVisit && status === 'sample_collected' ? STATUS_LABEL['confirmed'] : STATUS_LABEL[status]}
          </Badge>
          {booking.scheduledFor && (
            <span className="text-xs text-slate-500">
              Scheduled {formatDateTime(booking.scheduledFor)}
            </span>
          )}
        </div>

        {error && (
          <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}

        {fullOrderEditor ? <LabOrderDetailsEditor key={`${booking.id}-${inlineVersion}`} booking={booking}
          onEditing={() => setEditingOrder(true)} onBusy={setInlineBusy}
          onSaved={() => { setEditingOrder(false); onChanged(); onClose(); }} /> : (
        <DetailList
          rows={[
            { label: 'Member', value: booking.contactName ?? booking.memberName },
            ...phoneRows.map((p) => ({
              label: p.label,
              value: (
                <div className="flex items-center gap-1.5">
                  <span>{p.phone || '—'}</span>
                  <a
                    href={telHref(p.phone)}
                    title="Call this number"
                    className={`rounded-md border border-slate-300 p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700 ${
                      telHref(p.phone) ? '' : 'pointer-events-none opacity-40'
                    }`}
                  >
                    <Icon name="phone" className="h-3.5 w-3.5" />
                  </a>
                  <a
                    href={whatsappHref(p.phone)}
                    target="_blank"
                    rel="noreferrer"
                    title="Message on WhatsApp"
                    className={`rounded-md border border-slate-300 p-[7px] text-emerald-600 hover:bg-emerald-50 ${
                      whatsappHref(p.phone) ? '' : 'pointer-events-none opacity-40'
                    }`}
                  >
                    <Icon name="whatsapp" className="h-3.5 w-3.5" />
                  </a>
                </div>
              ),
            })),
            { label: 'Test', value: booking.packageName },
            {
              label: 'Service',
              value: booking.fulfillmentType === 'store_visit' ? 'Store Visit' : 'Home Collection',
            },
            { label: 'Branch', value: booking.storeName || '—' },
            {
              label: `Patients (${booking.patientsCount})`,
              value:
                booking.patients.length === 0 ? (
                  '—'
                ) : (
                  <ul className="space-y-0.5">
                    {booking.patients.map((p, i) => (
                      <li key={i}>
                        {p.name}
                        {p.age !== null && (
                          <span className="font-normal text-slate-500"> · {p.age} yrs</span>
                        )}
                        {/* Only shown when this patient's own address differs
                            from the booking's shared one — the common case
                            (everyone at home together) stays quiet. */}
                        {homeCollection && p.address && p.address !== booking.address && (
                          <span className="mt-0.5 block text-xs font-normal text-slate-500">
                            {p.address}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ),
            },
            ...(booking.fulfillmentType === 'store_visit'
              ? []
              : [
                  {
                    label: 'Collection address',
                    value: booking.address || (
                      <span className="font-normal text-slate-400">No address on this booking</span>
                    ),
                  },
                ]),
            ...(homeCollection
              ? [{ label: 'Assigned staff', value: booking.assignedStaffName || <span className="font-normal text-rose-500">Not assigned</span> }]
              : []),
            { label: 'Unit price', value: formatCurrency(booking.unitPrice) },
            ...(Number(booking.fuelCharge || 0) > 0
              ? [{ label: 'Fuel charge', value: formatCurrency(booking.fuelCharge!) }]
              : []),
            ...(Number(booking.techFee || 0) > 0
              ? [{ label: 'Technician charge', value: formatCurrency(booking.techFee!) }]
              : []),
            ...(Number(booking.fixCharge || 0) > 0 && !booking.fuelCharge && !booking.techFee
              ? [{ label: 'Fixed charge', value: formatCurrency(booking.fixCharge!) }]
              : []),
            { label: 'Total', value: formatCurrency(booking.totalPrice) },
            { label: 'Booked', value: formatDateTime(booking.createdAt) },
          ]}
        />

        )}

        <fieldset disabled={editingOrder || inlineBusy} className="min-w-0">
        {/* ---- Billing: price it, upload the paper invoice photo, then
            collect from the member's wallet under an OTP, with any
            remainder taken as cash — the same flow BillEditorModal gives a
            standard order's bill, sized down to what a lab booking needs
            (no line-item picker — price is fixed at booking/verify time).
            Shown once the report is ready to bill, and stays shown (as a
            read-only recap once paid) for a booking already billed. */}
        {(canBillBooking(status) || billed) && (
          <section className="mt-4 rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Billing</h3>
              {effectivePaid && <Badge tone="green">Paid</Badge>}
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Unit price</span>
                    <span className="text-slate-800">{formatCurrency(booking.unitPrice)}</span>
                  </div>
                  {Number(booking.fuelCharge || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Fuel charge</span>
                      <span className="text-slate-800">{formatCurrency(booking.fuelCharge!)}</span>
                    </div>
                  )}
                  {Number(booking.techFee || 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Technician charge</span>
                      <span className="text-slate-800">{formatCurrency(booking.techFee!)}</span>
                    </div>
                  )}
                  {Number(booking.fixCharge || 0) > 0 && !booking.fuelCharge && !booking.techFee && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Fixed charge</span>
                      <span className="text-slate-800">{formatCurrency(booking.fixCharge!)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Subtotal</span>
                    <span className="text-slate-800">{formatCurrency(booking.totalPrice)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Disc amount</span>
                    <input
                      value={billDiscount || ''}
                      onChange={(e) => setBillDiscount(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="0"
                      inputMode="decimal"
                      disabled={billed || billBusy}
                      className="w-28 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-right text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 font-semibold text-slate-800">
                    <span>Bill total</span>
                    <span>{formatCurrency(billed ? booking.billAmount : netTotal)}</span>
                  </div>
                </div>

                <div className="mt-3 flex items-start gap-3">
                  {billImage && (
                    <button
                      type="button"
                      onClick={() => window.open(billImage, '_blank', 'noopener,noreferrer')}
                      title="Open full size"
                      className="shrink-0 overflow-hidden rounded-md border border-slate-200"
                    >
                      <img src={billImage} alt="Uploaded bill" className="h-16 w-16 object-cover" />
                    </button>
                  )}
                  {!billed && (
                    <div className="flex items-center gap-3">
                      <label
                        className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs font-medium ${
                          billBusy || billImageBusy
                            ? 'cursor-not-allowed border-brand-400 bg-brand-50/50 text-brand-700 opacity-50'
                            : 'cursor-pointer border-brand-400 bg-brand-50/50 text-brand-700 hover:bg-brand-50'
                        }`}
                      >
                        <span aria-hidden className="text-base leading-none">+</span>
                        {billImageBusy ? 'Reading picture…' : billImage ? 'Change picture' : 'Upload bill from gallery'}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={billBusy || billImageBusy}
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            void onPickBillImage(file ?? null);
                          }}
                          ref={billFileInput}
                        />
                      </label>
                      {billImage && (
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-600 hover:text-rose-700"
                          onClick={() => setBillImage('')}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {billError && <p className="mt-2 text-xs text-rose-600">{billError}</p>}

                <div className="mt-3">
                  {!effectivePaid && (
                    <Button
                      size="sm"
                      disabled={billBusy || billImageBusy}
                      onClick={() => void sendBill()}
                    >
                      {billBusy ? 'Saving…' : billed ? 'Update bill & collect →' : 'Convert to bill →'}
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Member wallet
                </p>
                <WalletBreakdown
                  walletBalance={walletBalance ?? 0}
                  monthlyRedeemable={walletPreview?.monthlyRedeemable ?? null}
                  redeemedThisMonth={walletPreview?.redeemedThisMonth ?? null}
                  availableAllowance={walletPreview?.availableAllowance ?? null}
                  walletShare={walletCoverage}
                  walletShareLabel={effectivePaid ? 'From wallet' : 'Will draw from wallet'}
                  cashOwed={cashOwed}
                  format={formatCurrency}
                />
              </div>
            </div>
          </section>
        )}

        {/* ---- Assigned staff (home collection only) — its own immediate
            save, separate from the batched "Booking details" edits below;
            see onAssignStaff's own doc. Mandatory before this booking can be
            confirmed (staffRequiredBlocker above gates the Confirm button). */}
        {!fullOrderEditor && homeCollection && (
          <section className="mt-4 rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Assigned staff</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Who collects this booking's sample. Required before it can be confirmed.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={booking.assignedStaffId}
                disabled={staffBusy || closed}
                onChange={(e) => void onAssignStaff(e.target.value)}
                className={`${inputClass} max-w-xs`}
              >
                <option value="">— Not assigned —</option>
                {(labStaff.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {staffBusy && <span className="text-xs text-slate-400">Saving…</span>}
            </div>
            {staffError && <p className="mt-2 text-xs text-rose-600">{staffError}</p>}
          </section>
        )}

        {/* ---- Booking details: schedule, note, branch, patients, address ---- */}
        {!fullOrderEditor && <section className="mt-5 rounded-lg border border-slate-200 p-4">
          <button
            type="button"
            onClick={() => setScheduleOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-800">Booking details</h3>
              {!scheduleOpen && (
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {booking.scheduledFor ? formatDateTime(booking.scheduledFor) : 'Not scheduled'}
                  {booking.note ? ` · ${booking.note}` : ''}
                </p>
              )}
            </div>
            <Icon
              name="chevron-down"
              className={`h-4 w-4 shrink-0 text-slate-400 ${scheduleOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {scheduleOpen && (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600">
                  Scheduled for
                  <input
                    type="datetime-local"
                    value={schedule}
                    disabled={!canReschedule(status) || busy !== null}
                    onChange={(e) => setSchedule(e.target.value)}
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Branch
                  <select
                    value={storeCode}
                    disabled={!detailsEditable || busy !== null}
                    onChange={(e) => setStoreCode(e.target.value)}
                    className={`${inputClass} mt-1`}
                  >
                    {!labStores.some((s) => s.code === storeCode) && (
                      <option value={storeCode}>{booking.storeName || storeCode || '—'}</option>
                    )}
                    {labStores.map((s) => (
                      <option key={s.id} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
                  Note to the member
                  <textarea
                    value={note}
                    rows={2}
                    maxLength={300}
                    disabled={!canEditNote(status) || busy !== null}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Please come fasting for 10–12 hours."
                    className={`${inputClass} mt-1`}
                  />
                </label>
                {homeCollection && (
                  <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
                    Collection address
                    <textarea
                      value={address}
                      rows={2}
                      maxLength={500}
                      disabled={!detailsEditable || busy !== null}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="No address on this booking"
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                )}
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">
                    Patients ({patients.length})
                  </span>
                  {detailsEditable && (
                    <button
                      type="button"
                      disabled={busy !== null || editingOrder || inlineBusy}
                      onClick={addPatientRow}
                      className="text-xs font-medium text-brand-600"
                    >
                      + Add patient
                    </button>
                  )}
                </div>
                <div className="mt-2 space-y-2">
                  {patients.map((p, i) => (
                    <div key={i} className="rounded-md border border-slate-100 p-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={p.name}
                          placeholder="Name"
                          disabled={!detailsEditable || busy !== null}
                          onChange={(e) => patchPatientRow(i, { name: e.target.value })}
                          className={`${inputClass} flex-1`}
                        />
                        <input
                          value={p.age}
                          placeholder="Age"
                          inputMode="numeric"
                          disabled={!detailsEditable || busy !== null}
                          onChange={(e) => patchPatientRow(i, { age: e.target.value.replace(/\D/g, '') })}
                          className={`${inputClass} w-20`}
                        />
                        {detailsEditable && patients.length > 1 && (
                          <button
                            type="button"
                            disabled={busy !== null || editingOrder || inlineBusy}
                            onClick={() => removePatientRow(i)}
                            title="Remove this patient"
                            className="rounded-md border border-slate-200 p-1.5 text-rose-500 hover:bg-rose-50"
                          >
                            <Icon name="close" className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {homeCollection && (
                        <input
                          value={p.addressOverride}
                          placeholder={p.resolvedAddress || "Uses the booking's own collection address"}
                          disabled={!detailsEditable || busy !== null}
                          onChange={(e) => patchPatientRow(i, { addressOverride: e.target.value })}
                          className={`${inputClass} mt-1.5 w-full`}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {patientsError && <p className="mt-2 text-xs text-rose-600">{patientsError}</p>}
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  {closed
                    ? 'A cancelled booking can no longer be edited.'
                    : status === 'report_ready'
                      ? 'The date is fixed once the report is ready; the rest can still change.'
                      : 'The member sees the date and note beside this booking in the app.'}
                </p>
                <Button
                  size="sm"
                  disabled={!dirty || busy !== null}
                  onClick={() => void saveDetails()}
                >
                  {busy === 'details' ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </>
          )}
        </section>}
        </fieldset>
      </Modal>

      <Modal
        open={showOtpPopover}
        onClose={() => (collected ? onClose() : setShowOtpPopover(false))}
        title={walletCoverage > 0 ? 'Verify OTP to collect payment' : 'Collect payment'}
        footer={
          collected ? (
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          ) : walletCoverage <= 0 ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setShowOtpPopover(false)}>
                Close
              </Button>
              <Button size="sm" disabled={otpBusy} onClick={() => void collectCashOnly()}>
                {otpBusy ? 'Collecting…' : `Collect ${formatCurrency(cashOwed)} as cash`}
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setShowOtpPopover(false)}>
              Close
            </Button>
          )
        }
      >
        {collected ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <Icon name="check" className="h-8 w-8 text-emerald-600" />
            </span>
            <p className="text-sm font-medium text-emerald-700">
              {collected.walletAmount > 0
                ? `${formatCurrency(collected.walletAmount)} was debited from the member's wallet.`
                : "The member's wallet had nothing to debit."}
            </p>
            <p className="text-sm font-medium text-emerald-700">
              {collected.cashAmount > 0
                ? `${formatCurrency(collected.cashAmount)} was collected as cash. This bill is paid.`
                : 'This bill is fully paid.'}
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {walletCoverage > 0 ? (
                <>
                  A one-time code was sent to {booking.memberPhone}. Enter what the member reads
                  out to you — once it checks out, {formatCurrency(walletCoverage)} is debited
                  from their wallet automatically.{' '}
                  {cashOwed > 0
                    ? `The remaining ${formatCurrency(cashOwed)} is then collected as cash.`
                    : 'The bill is then paid in full.'}
                </>
              ) : (
                <>The member's wallet has nothing to draw. Collect {formatCurrency(cashOwed)} as cash.</>
              )}
            </p>
            {walletCoverage > 0 && (
              otpBusy && !otpConfirmation ? (
                <p className="text-sm text-slate-500">Sending code…</p>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    autoFocus
                    disabled={!otpConfirmation || otpBusy}
                    className={inputClass}
                  />
                  <Button
                    size="sm"
                    disabled={otpBusy || !otpConfirmation || !/^\d{6}$/.test(otpCode.trim())}
                    onClick={() => void verifyAndCollect()}
                  >
                    {otpBusy ? 'Verifying…' : 'Verify & collect'}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={otpBusy} onClick={() => void sendOtp()}>
                    Resend
                  </Button>
                </div>
              )
            )}
            {otpError && <p className="mt-2 text-xs text-rose-600">{otpError}</p>}
          </>
        )}
      </Modal>

      {preview && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-4"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview.image}
            alt={preview.name || 'Report page'}
            className="max-h-full max-w-full rounded-md bg-white object-contain"
          />
        </div>
      )}

      {confirmDialog}
    </>
  );
}
