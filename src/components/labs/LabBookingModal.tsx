import { useEffect, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { WalletBreakdown } from '@/components/orders/WalletBreakdown';
import { telHref, whatsappHref } from '@/lib/contactLinks';
import { formatCurrency, formatDateTime, toneForStatus } from '@/lib/format';
import { fileToResizedDataUrl } from '@/lib/images';
import { clearDeliveryOtp, confirmDeliveryOtp, describeOtpError, sendDeliveryOtp } from '@/lib/deliveryOtp';
import {
  MAX_REPORT_PAGES,
  canAttachReport,
  canEditNote,
  canRemoveReportPage,
  canReschedule,
  fromLocalInput,
  nextStepBlocker,
  reportFilesProblem,
  toLocalInput,
} from '@/lib/labBooking';
import { dbErrorMessage } from '@/lib/db';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/context/AuthContext';
import { useConfirmDialog } from '@/lib/useConfirmDialog';
import {
  addLabReportPages,
  collectLabBillWithWallet,
  getWalletBalanceForLabBooking,
  listLabReportPages,
  removeLabReportPage,
  sendLabBookingBill,
  setLabBookingStatus,
  updateLabBookingDetails,
} from '@/api/labBookings';
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
}: {
  booking: LabBooking | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  if (!booking) return null;
  return (
    <BookingWindow
      key={booking.id}
      booking={booking}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

function BookingWindow({
  booking,
  onClose,
  onChanged,
}: {
  booking: LabBooking;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [schedule, setSchedule] = useState(toLocalInput(booking.scheduledFor));
  const [note, setNote] = useState(booking.note);
  const [pages, setPages] = useState<LabReportPage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(booking.reportPages > 0);
  const [busy, setBusy] = useState<'status' | 'details' | 'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const [preview, setPreview] = useState<LabReportPage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { accessToken } = useAuth();

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

  const { data: walletBalance } = useAsync(
    () => getWalletBalanceForLabBooking(booking.id),
    [booking.id],
  );

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
      void startCollection();
    } catch (err) {
      setBillError(dbErrorMessage(err));
    } finally {
      setBillBusy(false);
    }
  }

  // ---- OTP-gated wallet collection — identical mechanics to
  // BillEditorModal's own (see that file's doc): sendOtp only asks Firebase
  // to text the member's phone a code; verifyAndCollect is the one place
  // that actually calls collectLabBillWithWallet, and only once Firebase has
  // confirmed the code staff typed in matches.
  const [otpConfirmation, setOtpConfirmation] = useState<ConfirmationResult | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [collected, setCollected] = useState<{ walletAmount: number; cashAmount: number } | null>(
    null,
  );
  const [showOtpPopover, setShowOtpPopover] = useState(false);
  const recaptchaContainerId = `lab-bill-otp-recaptcha-${booking.id}`;
  const otpInFlight = useRef(false);
  const otpSession = useRef(0);

  useEffect(() => {
    return () => {
      otpSession.current += 1;
      clearDeliveryOtp(recaptchaContainerId);
    };
  }, [recaptchaContainerId]);

  async function sendOtp() {
    if (otpInFlight.current) return;
    otpInFlight.current = true;
    const session = otpSession.current;
    setOtpBusy(true);
    setOtpError(null);
    setOtpConfirmation(null);
    setOtpCode('');
    try {
      const confirmation = await sendDeliveryOtp(booking.memberPhone, recaptchaContainerId);
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

  async function startCollection() {
    setShowOtpPopover(true);
    await sendOtp();
  }

  async function verifyAndCollect() {
    if (otpInFlight.current || !otpConfirmation || !/^\d{6}$/.test(otpCode.trim())) return;
    otpInFlight.current = true;
    const session = otpSession.current;
    setOtpBusy(true);
    setOtpError(null);
    try {
      await confirmDeliveryOtp(otpConfirmation, otpCode);
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

  async function loadPages() {
    setPagesLoading(true);
    try {
      setPages(await listLabReportPages(booking.id));
    } catch (err) {
      setError(dbErrorMessage(err));
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
  const dirty =
    (canReschedule(status) && scheduleChanged) || (canEditNote(status) && noteChanged);

  const next = NEXT[status];
  const blocker = nextStepBlocker(status, pages.length || booking.reportPages);

  async function run<T>(kind: NonNullable<typeof busy>, action: () => Promise<T>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      setError(dbErrorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function changeStatus(to: LabBookingStatus) {
    return run('status', () => setLabBookingStatus(booking.id, to));
  }

  function saveDetails() {
    return run('details', () =>
      updateLabBookingDetails(booking.id, {
        scheduledFor: canReschedule(status)
          ? fromLocalInput(schedule)
          : booking.scheduledFor || null,
        note,
      }),
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
      await addLabReportPages(booking.id, resized);
    });
    if (ok) await loadPages();
  }

  async function removePage(page: LabReportPage) {
    const ok = await run('remove', () => removeLabReportPage(booking.id, page.id));
    if (ok) await loadPages();
  }

  const phoneRows = [
    { label: 'Phone', phone: booking.memberPhone },
    ...(booking.addressPhone &&
    booking.addressPhone.replace(/\D/g, '').slice(-10) !==
      booking.memberPhone.replace(/\D/g, '').slice(-10)
      ? [{ label: 'Address contact', phone: booking.addressPhone }]
      : []),
  ];

  return (
    <>
      <Modal
        open
        size="full"
        onClose={onClose}
        title={booking.code}
        footer={
          <>
            {status !== 'cancelled' && status !== 'report_ready' && (
              <Button
                variant="danger"
                disabled={busy !== null}
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
            {next && (
              <Button
                variant="primary"
                disabled={busy !== null || blocker !== null || dirty}
                title={
                  blocker ??
                  (dirty ? 'Save your changes to the schedule / note first.' : undefined)
                }
                onClick={() => void changeStatus(next)}
              >
                {status === 'requested' && <Icon name="check" className="h-4 w-4" />}
                {NEXT_LABEL[status]}
              </Button>
            )}
          </>
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <Badge tone={toneForStatus(status)}>{STATUS_LABEL[status]}</Badge>
          {booking.scheduledFor && (
            <span className="text-xs text-slate-500">
              Scheduled {formatDateTime(booking.scheduledFor)}
            </span>
          )}
        </div>

        {error && (
          <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}

        <DetailList
          rows={[
            { label: 'Member', value: booking.memberName },
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
            { label: 'Package', value: booking.packageName },
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
                      </li>
                    ))}
                  </ul>
                ),
            },
            {
              label: 'Collection address',
              value: booking.address || (
                <span className="font-normal text-slate-400">No address on this booking</span>
              ),
            },
            { label: 'Unit price', value: formatCurrency(booking.unitPrice) },
            { label: 'Total', value: formatCurrency(booking.totalPrice) },
            { label: 'Booked', value: formatDateTime(booking.createdAt) },
          ]}
        />

        {/* ---- Schedule & note ---- */}
        <section className="mt-5 rounded-lg border border-slate-200 p-4">
          <button
            type="button"
            onClick={() => setScheduleOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-800">Schedule &amp; note</h3>
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
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  {closed
                    ? 'A cancelled booking can no longer be edited.'
                    : status === 'report_ready'
                      ? 'The date is fixed once the report is ready; the note can still change.'
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
        </section>

        {/* ---- Report ---- */}
        <section className="mt-4 rounded-lg border border-slate-200 p-4">
          <button
            type="button"
            onClick={() => setReportOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <h3 className="text-sm font-semibold text-slate-800">
              Lab report{' '}
              <span className="font-normal text-slate-400">
                ({pages.length || booking.reportPages}/{MAX_REPORT_PAGES} pages)
              </span>
            </h3>
            <Icon
              name="chevron-down"
              className={`h-4 w-4 shrink-0 text-slate-400 ${reportOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {reportOpen && (
            <>
              {canAttachReport(status) && (
                <div className="mt-3 flex justify-end">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => void onPickFiles(e.target.files)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" />
                    {busy === 'upload' ? 'Uploading…' : 'Add pages'}
                  </Button>
                </div>
              )}

              {!canAttachReport(status) ? (
                <p className="mt-2 text-xs text-slate-400">
                  {closed
                    ? 'This booking was cancelled.'
                    : 'The report can be attached once the sample has been collected.'}
                </p>
              ) : pagesLoading ? (
                <p className="mt-3 text-sm text-slate-400">Loading report…</p>
              ) : pages.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  Attach a photo or scan of each report page (JPG or PNG). You can mark the booking
                  Report ready once at least one page is attached — the member can then open it from
                  the app.
                </p>
              ) : (
                <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {pages.map((page, i) => (
                    <li key={page.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => setPreview(page)}
                        className="block w-full overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                        title={page.name || `Page ${i + 1}`}
                      >
                        <img
                          src={page.image}
                          alt={`Report page ${i + 1}`}
                          className="h-28 w-full object-cover"
                        />
                      </button>
                      <span className="absolute left-1 top-1 rounded bg-slate-900/70 px-1.5 text-[10px] font-medium text-white">
                        {i + 1}
                      </span>
                      {canRemoveReportPage(status, pages.length) && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() =>
                            ask({
                              title: 'Remove this report page?',
                              message: `Page ${i + 1} of ${booking.code}'s report will be removed. This cannot be undone.`,
                              confirmLabel: 'Remove page',
                              danger: true,
                              onConfirm: () => removePage(page),
                            })
                          }
                          title="Remove this page"
                          className="absolute right-1 top-1 rounded bg-white/90 p-1 text-rose-600 shadow hover:bg-rose-50 disabled:opacity-50"
                        >
                          <Icon name="close" className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {blocker && canAttachReport(status) && (
                <p className="mt-3 text-xs text-amber-600">{blocker}</p>
              )}
            </>
          )}
        </section>

        {/* ---- Billing ---- */}
        <section className="mt-4 rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-800">Billing</h3>
            {billed && (
              <Badge tone={effectivePaid ? 'green' : 'amber'}>
                {effectivePaid ? 'Paid' : 'Awaiting payment'}
              </Badge>
            )}
          </div>

          {closed ? (
            <p className="mt-2 text-xs text-slate-400">This booking was cancelled.</p>
          ) : effectivePaid ? (
            <div className="mt-3 space-y-1 text-sm text-slate-700">
              <p>
                Bill total <span className="font-semibold">{formatCurrency(booking.billAmount)}</span>
              </p>
              <p className="text-xs text-slate-500">
                {formatCurrency(collected?.walletAmount ?? booking.billWalletCollected)} from wallet
                {(collected?.cashAmount ?? booking.billCashCollected) > 0 && (
                  <> · {formatCurrency(collected?.cashAmount ?? booking.billCashCollected)} in cash</>
                )}
              </p>
            </div>
          ) : (
            <>
              {billError && (
                <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{billError}</p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600">
                  Disc. amount
                  <input
                    type="number"
                    min={0}
                    value={billDiscount || ''}
                    disabled={billBusy}
                    onChange={(e) => setBillDiscount(Number(e.target.value) || 0)}
                    className={`${inputClass} mt-1`}
                  />
                </label>
                <div className="text-xs font-medium text-slate-600">
                  Bill total
                  <p className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm font-semibold text-slate-800">
                    {formatCurrency(netTotal)}
                  </p>
                </div>
                <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
                  Invoice photo (optional)
                  <input
                    ref={billFileInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void onPickBillImage(e.target.files?.[0] ?? null)}
                  />
                  <div className="mt-1 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={billImageBusy || billBusy}
                      onClick={() => billFileInput.current?.click()}
                    >
                      {billImageBusy ? 'Reading…' : billImage ? 'Replace photo' : 'Add photo'}
                    </Button>
                    {billImage && (
                      <img src={billImage} alt="Invoice" className="h-10 w-10 rounded object-cover" />
                    )}
                  </div>
                </label>
              </div>
              {!showOtpPopover ? (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" disabled={billBusy} onClick={() => void sendBill()}>
                    {billBusy ? 'Converting…' : billed ? 'Update bill' : 'Convert to bill →'}
                  </Button>
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <WalletBreakdown
                    walletBalance={walletBalance ?? 0}
                    monthlyRedeemable={null}
                    redeemedThisMonth={null}
                    availableAllowance={null}
                    walletShare={walletCoverage}
                    walletShareLabel="Will draw from wallet"
                    cashOwed={cashOwed}
                    format={formatCurrency}
                  />
                  {otpError && <p className="mt-2 text-xs text-rose-600">{otpError}</p>}
                  {otpBusy && !otpConfirmation ? (
                    <p className="mt-2 text-xs text-slate-500">Sending the code to {booking.memberPhone}…</p>
                  ) : otpConfirmation ? (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code"
                        inputMode="numeric"
                        disabled={otpBusy}
                        className={`${inputClass} w-32`}
                      />
                      <Button
                        size="sm"
                        disabled={otpBusy || !/^\d{6}$/.test(otpCode.trim())}
                        onClick={() => void verifyAndCollect()}
                      >
                        {otpBusy ? 'Verifying…' : 'Verify & collect'}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={otpBusy} onClick={() => void sendOtp()}>
                        Resend
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" disabled={otpBusy} onClick={() => void sendOtp()}>
                      Send code
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
          <div id={recaptchaContainerId} />
        </section>
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
