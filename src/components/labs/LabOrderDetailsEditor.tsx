import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { listStores } from '@/api/stores';
import { listLabStaff, updateLabBookingDetails } from '@/api/labBookings';
import { labPatientAge, blankOrderPatient, labOrderDetailsDraft, labOrderDetailsInput, validateLabOrderDetails, type OrderPatientDraft } from '@/lib/labOrderDetails';
import type { LabBooking } from '@/types';

const fieldClass = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100';
interface TestOption { id: number; name: string; price: string | number }

export function LabOrderDetailsEditor({ booking, onClose, onSaved }: { booking: LabBooking; onClose: () => void; onSaved: () => void }) {
  const { accessToken } = useAuth();
  const [draft, setDraft] = useState(() => labOrderDetailsDraft(booking));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stores = useAsync(() => listStores(accessToken), [accessToken]);
  const tests = useAsync(() => api.get<TestOption[]>('/v1/public/care/lab-packages', accessToken), [accessToken]);
  const branchCode = stores.data?.find((store) => store.id === draft.storeId)?.code ?? booking.storeCode;
  const staff = useAsync(() => listLabStaff(branchCode || undefined, accessToken), [accessToken, branchCode]);
  const paid = booking.billStatus === 'paid';
  const patch = (change: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...change }));
  const patchPatient = (index: number, change: Partial<OrderPatientDraft>) => setDraft((current) => ({ ...current, patients: current.patients.map((p, i) => i === index ? { ...p, ...change } : p) }));

  async function save() {
    const problem = validateLabOrderDetails(draft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      await updateLabBookingDetails(booking.id, labOrderDetailsInput(draft), accessToken);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save order details.');
    } finally { setBusy(false); }
  }

  return <Modal open size="full" title={`Edit order details - ${booking.code}`} onClose={() => { if (!busy) onClose(); }} footer={<>
    <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
    <Button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save order details'}</Button>
  </>}>
    <p className="mb-4 text-sm text-slate-500">These changes apply to this lab order. The member account and saved patient/address records stay unchanged.</p>
    {error && <p role="alert" className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <h3 className="font-semibold sm:col-span-2">Contact and collection details</h3>
        <label>Member / booking contact name<input className={fieldClass} value={draft.contactName} maxLength={160} onChange={(e) => patch({ contactName: e.target.value })} /></label>
        <label>Booking contact phone<input className={fieldClass} value={draft.contactPhone} inputMode="tel" maxLength={10} onChange={(e) => patch({ contactPhone: e.target.value })} /></label>
        <label>Address contact phone<input className={fieldClass} value={draft.addressPhone} inputMode="tel" maxLength={10} onChange={(e) => patch({ addressPhone: e.target.value })} /></label>
        <label>Service<select className={fieldClass} value={draft.fulfillmentType} onChange={(e) => patch({ fulfillmentType: e.target.value })}><option value="HOME_COLLECTION">Home Collection</option><option value="STORE_VISIT">Store Visit</option></select></label>
        <label>Branch<select className={fieldClass} value={draft.storeId} onChange={(e) => patch({ storeId: e.target.value, assignedStaffId: '' })}>
          <option value={booking.storeId ?? ''}>{booking.storeName || 'Choose a branch'}</option>
          {stores.data?.filter((s) => s.isActive && s.offersLabCollection && s.id !== booking.storeId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label>Assigned lab staff<select className={fieldClass} value={draft.assignedStaffId} disabled={draft.fulfillmentType !== 'HOME_COLLECTION'} onChange={(e) => patch({ assignedStaffId: e.target.value })}>
          <option value="">Not assigned</option>
          {booking.assignedStaffId && !staff.data?.some((s) => s.id === booking.assignedStaffId) && <option value={booking.assignedStaffId}>{booking.assignedStaffName}</option>}
          {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label className="sm:col-span-2">Collection address (optional)<textarea className={fieldClass} rows={3} maxLength={500} value={draft.address} onChange={(e) => patch({ address: e.target.value })} /></label>
      </section>
      <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <h3 className="font-semibold sm:col-span-2">Test, price and schedule</h3>
        <label>Test / package<select className={fieldClass} value={draft.labPackageId} disabled={paid || booking.reportPages > 0} onChange={(e) => {
          const chosen = tests.data?.find((test) => String(test.id) === e.target.value);
          patch({ labPackageId: e.target.value, ...(chosen ? { unitPrice: String(chosen.price) } : {}) });
        }}>
          <option value={booking.labPackageId ?? ''}>{booking.packageName}</option>
          {tests.data?.filter((t) => String(t.id) !== booking.labPackageId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
        <label>Unit price (per patient)<input className={fieldClass} value={draft.unitPrice} type="number" min="0" step="0.01" disabled={paid} onChange={(e) => patch({ unitPrice: e.target.value })} /></label>
        <label>Scheduled for<input className={fieldClass} value={draft.scheduledFor} type="datetime-local" onChange={(e) => patch({ scheduledFor: e.target.value })} /></label>
        <div className="self-end py-2 text-sm">Order total: <strong>{formatCurrency(Number(draft.unitPrice || 0) * draft.patients.length)}</strong><p className="text-xs text-slate-500">Calculated from unit price × patient count.</p></div>
        <label className="sm:col-span-2">Order notes / instructions<textarea className={fieldClass} value={draft.note} rows={3} onChange={(e) => patch({ note: e.target.value })} /></label>
        {(paid || booking.reportPages > 0) && <p className="text-xs text-slate-500 sm:col-span-2">{paid ? 'Collected billing keeps its original charges. Billing corrections are required before changing the test, price or patient count.' : 'Remove the attached test report before replacing the test.'}</p>}
      </section>
      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Patient details ({draft.patients.length})</h3><Button size="sm" variant="secondary" disabled={paid} onClick={() => patch({ patients: [...draft.patients, blankOrderPatient()] })}>Add patient</Button></div>
        {draft.patients.map((patient, index) => <div key={index} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3">
          <label>Name<input className={fieldClass} value={patient.name} onChange={(e) => patchPatient(index, { name: e.target.value })} /></label>
          <label>Age<input className={fieldClass} type="number" min="0" max="120" value={patient.age} onChange={(e) => patchPatient(index, { age: e.target.value, dob: '' })} /></label>
          <label>Date of birth<input className={fieldClass} type="date" value={patient.dob} onChange={(e) => patchPatient(index, { dob: e.target.value, age: labPatientAge(e.target.value) })} /></label>
          <label>Phone<input className={fieldClass} inputMode="tel" maxLength={10} value={patient.phone} onChange={(e) => patchPatient(index, { phone: e.target.value })} /></label>
          <label>Gender<select className={fieldClass} value={patient.gender} onChange={(e) => patchPatient(index, { gender: e.target.value })}><option value="">Not provided</option>{['MALE', 'FEMALE', 'OTHER'].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
          <label>Relation<select className={fieldClass} value={patient.relation} onChange={(e) => patchPatient(index, { relation: e.target.value })}><option value="">Not provided</option>{['SELF', 'SPOUSE', 'CHILD', 'PARENT', 'OTHER'].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
          <label>ABHA (optional)<input className={fieldClass} maxLength={14} inputMode="numeric" value={patient.abhaId} onChange={(e) => patchPatient(index, { abhaId: e.target.value })} /></label>
          <label className="sm:col-span-2">Patient collection address (optional)<input className={fieldClass} maxLength={500} value={patient.addressOverride} placeholder="Uses the booking collection address" onChange={(e) => patchPatient(index, { addressOverride: e.target.value })} /></label>
          {draft.patients.length > 1 && <Button size="sm" variant="danger" disabled={paid} onClick={() => patch({ patients: draft.patients.filter((_, i) => i !== index) })}>Remove patient {index + 1}</Button>}
        </div>)}
      </section>
    </fieldset>
    {(stores.error || tests.error || staff.error) && <p role="alert" className="mt-3 text-sm text-rose-600">{stores.error || tests.error || staff.error}</p>}
    <p className="mt-4 text-xs text-slate-500">Order reference {booking.code} · Booked {formatDateTime(booking.createdAt)}. Original reference and creation time are kept for the order history.</p>
  </Modal>;
}
