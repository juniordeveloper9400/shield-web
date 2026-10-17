import { Children, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { telHref, whatsappHref } from '@/lib/contactLinks';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { listStores } from '@/api/stores';
import { listLabStaff, updateLabBookingDetails } from '@/api/labBookings';
import { listLabCharges, type LabCharge } from '@/api/labCharges';
import { calculateKmCharge, matchDistanceTier, type DistanceRate } from '@/lib/labCharges';
import {
  labPatientAge,
  blankOrderPatient,
  labOrderDetailsDraft,
  labOrderDetailsInput,
  validateLabOrderDetails,
  type OrderPatientDraft,
} from '@/lib/labOrderDetails';
import type { LabBooking } from '@/types';

const fieldClass =
  'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 disabled:text-slate-400';

interface TestOption {
  id: number;
  name: string;
  price: string | number;
}

export function LabOrderDetailsEditor({
  booking,
  onSaved,
  onEditing,
  onBusy,
}: {
  booking: LabBooking;
  onSaved: () => void;
  onEditing: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { accessToken } = useAuth();
  const [draft, setDraft] = useState(() => labOrderDetailsDraft(booking));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stores = useAsync(() => listStores(accessToken), [accessToken]);
  const tests = useAsync(() => api.get<TestOption[]>('/v1/public/care/lab-packages', accessToken), [accessToken]);
  const labCharges = useAsync(() => listLabCharges(accessToken), [accessToken]);

  const branchCode = stores.data?.find((store) => store.id === draft.storeId)?.code ?? booking.storeCode;
  const staff = useAsync(() => listLabStaff(branchCode || undefined, accessToken), [accessToken, branchCode]);

  const paid = booking.billStatus === 'paid';
  const patch = (change: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...change }));
  const patchPatient = (index: number, change: Partial<OrderPatientDraft>) =>
    setDraft((current) => ({
      ...current,
      patients: current.patients.map((p, i) => (i === index ? { ...p, ...change } : p)),
    }));

  const rawDist = (labCharges.data ?? []).find((c) => c.isActive && c.kind === 'DISTANCE');
  const activeDistanceRate: DistanceRate | null =
    rawDist && rawDist.kind === 'DISTANCE'
      ? {
          firstKm: rawDist.firstKm,
          firstAmount: rawDist.firstAmount,
          secondKm: rawDist.secondKm,
          secondAmount: rawDist.secondAmount,
          extraPerKm: rawDist.extraPerKm,
        }
      : null;

  const rawTech = (labCharges.data ?? []).find((c) => c.isActive && c.kind === 'TECHNICIAN');
  const activeTechCharge = rawTech && rawTech.kind === 'TECHNICIAN' ? rawTech : null;

  const [customerKm, setCustomerKm] = useState<string>('');
  const parsedKm = parseFloat(customerKm);
  const kmMatch = activeDistanceRate && !isNaN(parsedKm) && parsedKm > 0
    ? matchDistanceTier(parsedKm, activeDistanceRate)
    : null;

  const testSubtotal = Number(draft.unitPrice || 0) * draft.patients.length;
  const fixChargeAmount = Number(draft.fixCharge || 0);
  const calculatedTotal = testSubtotal + fixChargeAmount;

  async function save() {
    const problem = validateLabOrderDetails(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await updateLabBookingDetails(booking.id, labOrderDetailsInput(draft), accessToken);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save order details.');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <form
      id="lab-order-inline-details"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <p className="text-sm text-slate-500">
          Use the pencil beside a detail to edit it, then Save changes below. These changes apply to this lab order.
        </p>
        <span className="text-xs text-slate-400">
          Ref: <code className="font-semibold text-slate-700">{booking.code}</code> · Booked{' '}
          {formatDateTime(booking.createdAt)}
        </span>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      <fieldset disabled={busy} className="min-w-0">
        {/* Split View: Left Side (Test & Test Details + Fixed Charge) | Right Side (Member & Patient Details) */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ================= LEFT SIDE: Test Table, Fixed Charge, Schedule & Notes ================= */}
          <div className="space-y-5">
            {/* 1. Test & Test Details Table */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-brand-50 p-1.5 text-brand-600">
                    <Icon name="labs" className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Test &amp; Test Details</h3>
                    <p className="text-[11px] text-slate-400">Tests included and pricing per patient</p>
                  </div>
                </div>
                {paid && (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    Paid Order
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5">Test / Package</th>
                      <th className="px-3 py-2.5">Unit Price</th>
                      <th className="px-3 py-2.5 text-center">Patients</th>
                      <th className="px-3 py-2.5 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="hover:bg-slate-50/50">
                      <td className="min-w-[180px] px-3 py-3 align-top font-medium text-slate-800">
                        <select
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
                          value={draft.labPackageId}
                          disabled={paid || booking.reportPages > 0}
                          onChange={(e) => {
                            onEditing();
                            const chosen = tests.data?.find((test) => String(test.id) === e.target.value);
                            patch({
                              labPackageId: e.target.value,
                              ...(chosen ? { unitPrice: String(chosen.price) } : {}),
                            });
                          }}
                        >
                          <option value={booking.labPackageId ?? ''}>{booking.packageName}</option>
                          {tests.data
                            ?.filter((t) => String(t.id) !== booking.labPackageId)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                        {(paid || booking.reportPages > 0) && (
                          <p className="mt-1 text-[10px] text-slate-400">
                            {paid
                              ? 'Charges are locked for collected bills.'
                              : 'Remove attached report before replacing test.'}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-400">₹</span>
                          <input
                            className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100 disabled:text-slate-400"
                            value={draft.unitPrice}
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={paid}
                            onChange={(e) => {
                              onEditing();
                              patch({ unitPrice: e.target.value });
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center align-top font-medium text-slate-700">
                        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-700">
                          {draft.patients.length}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right align-top font-semibold text-slate-900">
                        {formatCurrency(testSubtotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 2. Fixed / Collection Charge Section */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-blue-50 p-1.5 text-blue-600">
                    <Icon name="deliveries" className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Collection / Lab Charge</h3>
                    <p className="text-[11px] text-slate-400">
                      Dynamic distance-based fuel rate and technician visit fee
                    </p>
                  </div>
                </div>
                {fixChargeAmount > 0 && (
                  <span className="rounded bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                    +{formatCurrency(fixChargeAmount)}
                  </span>
                )}
              </div>

              {/* Dynamic KM Range Calculator */}
              <div className="space-y-3">
                {activeDistanceRate ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Active Fuel Distance Range
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Up to {activeDistanceRate.firstKm}km (₹{activeDistanceRate.firstAmount}) · {activeDistanceRate.firstKm}–{activeDistanceRate.secondKm}km (₹{activeDistanceRate.secondAmount}) · &gt;{activeDistanceRate.secondKm}km (₹{activeDistanceRate.secondAmount}+₹{activeDistanceRate.extraPerKm}/km)
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <label className="text-xs font-medium text-slate-600">
                        Customer Distance:
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="1000"
                          placeholder="e.g. 4.5"
                          value={customerKm}
                          disabled={paid}
                          onChange={(e) => setCustomerKm(e.target.value)}
                          className="h-8 w-24 rounded border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200"
                        />
                        <span className="text-xs text-slate-500 font-medium">km</span>
                      </div>

                      {kmMatch && (
                        <div className="flex items-center gap-2 ml-auto">
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            {kmMatch.tierLabel}: ₹{kmMatch.charge}
                          </span>
                          <button
                            type="button"
                            disabled={paid}
                            onClick={() => {
                              onEditing();
                              patch({ fixCharge: String(kmMatch.charge) });
                            }}
                            className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm hover:bg-emerald-700"
                          >
                            Apply ₹{kmMatch.charge}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700">
                    Fuel distance rate is currently inactive. You can activate it under the Lab Charges menu or enter a custom amount below.
                  </p>
                )}

                {/* Quick Presets & Manual Input */}
                <div className="grid gap-3 sm:grid-cols-2 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Quick Charge Presets
                    </label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={paid}
                        onClick={() => {
                          onEditing();
                          patch({ fixCharge: '0' });
                        }}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                          fixChargeAmount === 0
                            ? 'bg-slate-800 text-white'
                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        No Charge (₹0)
                      </button>

                      {activeTechCharge && (
                        <button
                          type="button"
                          disabled={paid}
                          onClick={() => {
                            onEditing();
                            patch({ fixCharge: String(activeTechCharge.amount ?? 0) });
                          }}
                          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                            fixChargeAmount === (activeTechCharge.amount ?? 0)
                              ? 'bg-brand-600 text-white'
                              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          Tech Fee ({formatCurrency(activeTechCharge.amount ?? 0)})
                        </button>
                      )}

                      {kmMatch && activeTechCharge && (
                        <button
                          type="button"
                          disabled={paid}
                          onClick={() => {
                            onEditing();
                            const combined = kmMatch.charge + (activeTechCharge.amount ?? 0);
                            patch({ fixCharge: String(combined) });
                          }}
                          className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                        >
                          Fuel + Tech ({formatCurrency(kmMatch.charge + (activeTechCharge.amount ?? 0))})
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Applied charge amount (INR)
                      <div className="relative mt-1">
                        <input
                          className={fieldClass}
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={draft.fixCharge}
                          disabled={paid}
                          onChange={(e) => {
                            onEditing();
                            patch({ fixCharge: e.target.value });
                          }}
                        />
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </section>

            {/* 3. Order Total & Price Summary */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
              <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Calculation Summary
              </h4>
              <div className="space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>
                    Tests Subtotal ({draft.patients.length} patient
                    {draft.patients.length > 1 ? 's' : ''} × {formatCurrency(Number(draft.unitPrice || 0))})
                  </span>
                  <span className="font-medium text-slate-800">{formatCurrency(testSubtotal)}</span>
                </div>
                {fixChargeAmount > 0 && (
                  <div className="flex justify-between text-blue-700">
                    <span>Fixed / Lab Charge</span>
                    <span className="font-medium">+{formatCurrency(fixChargeAmount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                  <span className="font-semibold text-slate-800">Order Total</span>
                  <span className="text-base font-bold text-brand-600">
                    {formatCurrency(calculatedTotal)}
                  </span>
                </div>
              </div>
            </div>

            {/* 4. Schedule & Order Notes */}
            <section className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="pb-3 text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Icon name="receipt" className="h-4 w-4 text-brand-600" />
                Schedule &amp; Instructions
              </h3>
              <InlineField label="Scheduled for" onEditing={onEditing}>
                <input
                  className={fieldClass}
                  value={draft.scheduledFor}
                  type="datetime-local"
                  onChange={(e) => patch({ scheduledFor: e.target.value })}
                />
              </InlineField>
              <InlineField label="Order notes / instructions" onEditing={onEditing} className="sm:col-span-2">
                <textarea
                  className={fieldClass}
                  value={draft.note}
                  rows={3}
                  placeholder="e.g. Please come fasting for 10–12 hours."
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </InlineField>
            </section>
          </div>

          {/* ================= RIGHT SIDE: Member & Patient Details ================= */}
          <div className="space-y-5">
            {/* 1. Contact and Collection Details */}
            <section className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="pb-3">
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <Icon name="stores" className="h-4 w-4 text-brand-600" />
                  Contact and Collection Details
                </h3>
                <p className="text-[11px] text-slate-400">Member contact, service type, and collection location</p>
              </div>

              <InlineField label="Member / booking contact name" onEditing={onEditing}>
                <input
                  className={fieldClass}
                  value={draft.contactName}
                  maxLength={160}
                  onChange={(e) => patch({ contactName: e.target.value })}
                />
              </InlineField>
              <InlineField label="Booking contact phone" onEditing={onEditing}>
                <input
                  className={fieldClass}
                  value={draft.contactPhone}
                  inputMode="tel"
                  maxLength={10}
                  onChange={(e) => patch({ contactPhone: e.target.value })}
                />
              </InlineField>
              <InlineField label="Address contact phone" onEditing={onEditing}>
                <input
                  className={fieldClass}
                  value={draft.addressPhone}
                  inputMode="tel"
                  maxLength={10}
                  onChange={(e) => patch({ addressPhone: e.target.value })}
                />
              </InlineField>
              <InlineField label="Service" onEditing={onEditing}>
                <select
                  className={fieldClass}
                  value={draft.fulfillmentType}
                  onChange={(e) => patch({ fulfillmentType: e.target.value })}
                >
                  <option value="HOME_COLLECTION">Home Collection</option>
                  <option value="STORE_VISIT">Store Visit</option>
                </select>
              </InlineField>
              <InlineField label="Branch" onEditing={onEditing}>
                <select
                  className={fieldClass}
                  value={draft.storeId}
                  onChange={(e) => patch({ storeId: e.target.value, assignedStaffId: '' })}
                >
                  <option value={booking.storeId ?? ''}>{booking.storeName || 'Choose a branch'}</option>
                  {stores.data
                    ?.filter((s) => s.isActive && s.offersLabCollection && s.id !== booking.storeId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </InlineField>
              <InlineField label="Assigned lab staff" onEditing={onEditing}>
                <select
                  className={fieldClass}
                  value={draft.assignedStaffId}
                  disabled={draft.fulfillmentType !== 'HOME_COLLECTION'}
                  onChange={(e) => patch({ assignedStaffId: e.target.value })}
                >
                  <option value="">Not assigned</option>
                  {booking.assignedStaffId && !staff.data?.some((s) => s.id === booking.assignedStaffId) && (
                    <option value={booking.assignedStaffId}>{booking.assignedStaffName}</option>
                  )}
                  {staff.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </InlineField>
              <InlineField label="Collection address (optional)" onEditing={onEditing} className="sm:col-span-2">
                <textarea
                  className={fieldClass}
                  rows={3}
                  maxLength={500}
                  value={draft.address}
                  placeholder="Enter sample collection address"
                  onChange={(e) => patch({ address: e.target.value })}
                />
              </InlineField>
            </section>

            {/* 2. Patient Details */}
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Icon name="users" className="h-4 w-4 text-brand-600" />
                    Patient Details ({draft.patients.length})
                  </h3>
                  <p className="text-[11px] text-slate-400">Persons for whom tests will be performed</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={paid}
                  type="button"
                  onClick={() => {
                    onEditing();
                    patch({ patients: [...draft.patients, blankOrderPatient()] });
                  }}
                >
                  <Icon name="plus" className="mr-1 h-3.5 w-3.5" />
                  Add patient
                </Button>
              </div>

              <div className="space-y-3">
                {draft.patients.map((patient, index) => (
                  <div
                    key={index}
                    className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50 p-3.5 transition-all"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">
                        Patient #{index + 1} {patient.name ? `· ${patient.name}` : ''}
                      </span>
                      {draft.patients.length > 1 && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={paid}
                          type="button"
                          onClick={() => {
                            onEditing();
                            patch({ patients: draft.patients.filter((_, i) => i !== index) });
                          }}
                        >
                          <Icon name="close" className="mr-1 h-3 w-3" />
                          Remove
                        </Button>
                      )}
                    </div>

                    <InlineField label="Name" onEditing={onEditing}>
                      <input
                        className={fieldClass}
                        value={patient.name}
                        placeholder="Patient full name"
                        onChange={(e) => patchPatient(index, { name: e.target.value })}
                      />
                    </InlineField>
                    <InlineField label="Age" onEditing={onEditing}>
                      <input
                        className={fieldClass}
                        type="number"
                        min="0"
                        max="120"
                        placeholder="Years"
                        value={patient.age}
                        onChange={(e) => patchPatient(index, { age: e.target.value, dob: '' })}
                      />
                    </InlineField>
                    <InlineField label="Date of birth" onEditing={onEditing}>
                      <input
                        className={fieldClass}
                        type="date"
                        value={patient.dob}
                        onChange={(e) =>
                          patchPatient(index, { dob: e.target.value, age: labPatientAge(e.target.value) })
                        }
                      />
                    </InlineField>
                    <InlineField label="Phone" onEditing={onEditing}>
                      <input
                        className={fieldClass}
                        inputMode="tel"
                        maxLength={10}
                        placeholder="10 digit phone number"
                        value={patient.phone}
                        onChange={(e) => patchPatient(index, { phone: e.target.value })}
                      />
                    </InlineField>
                    <InlineField label="Gender" onEditing={onEditing}>
                      <select
                        className={fieldClass}
                        value={patient.gender}
                        onChange={(e) => patchPatient(index, { gender: e.target.value })}
                      >
                        <option value="">Not provided</option>
                        {['MALE', 'FEMALE', 'OTHER'].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </InlineField>
                    <InlineField label="Relation" onEditing={onEditing}>
                      <select
                        className={fieldClass}
                        value={patient.relation}
                        onChange={(e) => patchPatient(index, { relation: e.target.value })}
                      >
                        <option value="">Not provided</option>
                        {['SELF', 'SPOUSE', 'CHILD', 'PARENT', 'OTHER'].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </InlineField>
                    <InlineField label="ABHA (optional)" onEditing={onEditing}>
                      <input
                        className={fieldClass}
                        maxLength={14}
                        inputMode="numeric"
                        placeholder="14 digit ABHA number"
                        value={patient.abhaId}
                        onChange={(e) => patchPatient(index, { abhaId: e.target.value })}
                      />
                    </InlineField>
                    <InlineField
                      label="Patient collection address (optional)"
                      onEditing={onEditing}
                      className="sm:col-span-2"
                    >
                      <input
                        className={fieldClass}
                        maxLength={500}
                        value={patient.addressOverride}
                        placeholder="Uses the booking collection address"
                        onChange={(e) => patchPatient(index, { addressOverride: e.target.value })}
                      />
                    </InlineField>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </fieldset>

      {(stores.error || tests.error || staff.error || labCharges.error) && (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {stores.error || tests.error || staff.error || labCharges.error}
        </p>
      )}
    </form>
  );
}

interface InputProps {
  value?: unknown;
  type?: string;
  inputMode?: string;
  disabled?: boolean;
  children?: ReactNode;
}

/** The same detail row switches to its input when its pencil is pressed. */
function InlineField({
  label,
  children,
  onEditing,
  className = '',
}: {
  label: string;
  children: ReactElement<InputProps>;
  onEditing: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const { value, disabled, type, inputMode } = children.props;
  let display: ReactNode = value == null || value === '' ? 'Not provided' : String(value);

  if (children.type === 'select') {
    const selected = Children.toArray(children.props.children).find(
      (option) =>
        isValidElement<{ value?: unknown; children?: ReactNode }>(option) &&
        String(option.props.value ?? '') === String(value ?? ''),
    );
    if (isValidElement<{ children?: ReactNode }>(selected)) display = selected.props.children;
  } else if (type === 'datetime-local' && value) {
    display = formatDateTime(String(value));
  }

  return (
    <div className={`grid gap-2 py-2.5 text-sm sm:grid-cols-3 ${className}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="flex min-w-0 items-start gap-2 sm:col-span-2">
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs font-medium text-slate-800">
          {editing ? (
            <label>
              <span className="sr-only">{label}</span>
              {children}
            </label>
          ) : (
            display
          )}
        </div>
        {!editing && inputMode === 'tel' && Boolean(value) && (
          <div className="flex items-center gap-1">
            <a
              href={telHref(String(value))}
              aria-label={`Call ${label}`}
              title={`Call ${value}`}
              className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
              <Icon name="phone" className="h-3.5 w-3.5" />
            </a>
            <a
              href={whatsappHref(String(value))}
              target="_blank"
              rel="noreferrer"
              aria-label={`WhatsApp ${label}`}
              title={`WhatsApp ${value}`}
              className="rounded border border-emerald-200 p-1 text-emerald-600 hover:bg-emerald-50"
            >
              <Icon name="whatsapp" className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
        {!editing && !disabled && (
          <button
            type="button"
            aria-label={`Edit ${label}`}
            title={`Edit ${label}`}
            onClick={() => {
              setEditing(true);
              onEditing();
            }}
            className="shrink-0 rounded-md border border-slate-200 p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Icon name="edit" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
