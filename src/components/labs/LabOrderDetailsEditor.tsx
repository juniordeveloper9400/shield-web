import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { telHref, whatsappHref } from '@/lib/contactLinks';
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

export function LabOrderDetailsEditor({ booking, onSaved, onEditing, onBusy }: {
  booking: LabBooking; onSaved: () => void; onEditing: () => void; onBusy: (busy: boolean) => void;
}) {
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
    onBusy(true);
    setError('');
    try {
      await updateLabBookingDetails(booking.id, labOrderDetailsInput(draft), accessToken);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save order details.');
    } finally { setBusy(false); onBusy(false); }
  }

  return <form id="lab-order-inline-details" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <p className="mb-4 text-sm text-slate-500">Use the pencil beside a detail to edit it, then Save changes below. These changes apply to this lab order.</p>
    {error && <p role="alert" className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <section className="divide-y divide-slate-100">
        <h3 className="py-3 font-semibold">Contact and collection details</h3>
        <InlineField label="Member / booking contact name" onEditing={onEditing}><input className={fieldClass} value={draft.contactName} maxLength={160} onChange={(e) => patch({ contactName: e.target.value })} /></InlineField>
        <InlineField label="Booking contact phone" onEditing={onEditing}><input className={fieldClass} value={draft.contactPhone} inputMode="tel" maxLength={10} onChange={(e) => patch({ contactPhone: e.target.value })} /></InlineField>
        <InlineField label="Address contact phone" onEditing={onEditing}><input className={fieldClass} value={draft.addressPhone} inputMode="tel" maxLength={10} onChange={(e) => patch({ addressPhone: e.target.value })} /></InlineField>
        <InlineField label="Service" onEditing={onEditing}><select className={fieldClass} value={draft.fulfillmentType} onChange={(e) => patch({ fulfillmentType: e.target.value })}><option value="HOME_COLLECTION">Home Collection</option><option value="STORE_VISIT">Store Visit</option></select></InlineField>
        <InlineField label="Branch" onEditing={onEditing}><select className={fieldClass} value={draft.storeId} onChange={(e) => patch({ storeId: e.target.value, assignedStaffId: '' })}>
          <option value={booking.storeId ?? ''}>{booking.storeName || 'Choose a branch'}</option>
          {stores.data?.filter((s) => s.isActive && s.offersLabCollection && s.id !== booking.storeId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></InlineField>
        <InlineField label="Assigned lab staff" onEditing={onEditing}><select className={fieldClass} value={draft.assignedStaffId} disabled={draft.fulfillmentType !== 'HOME_COLLECTION'} onChange={(e) => patch({ assignedStaffId: e.target.value })}>
          <option value="">Not assigned</option>
          {booking.assignedStaffId && !staff.data?.some((s) => s.id === booking.assignedStaffId) && <option value={booking.assignedStaffId}>{booking.assignedStaffName}</option>}
          {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></InlineField>
        <InlineField label="Collection address (optional)" onEditing={onEditing} className="sm:col-span-2"><textarea className={fieldClass} rows={3} maxLength={500} value={draft.address} onChange={(e) => patch({ address: e.target.value })} /></InlineField>
      </section>
      <section className="divide-y divide-slate-100">
        <h3 className="py-3 font-semibold">Test, price and schedule</h3>
        <InlineField label="Test / package" onEditing={onEditing}><select className={fieldClass} value={draft.labPackageId} disabled={paid || booking.reportPages > 0} onChange={(e) => {
          const chosen = tests.data?.find((test) => String(test.id) === e.target.value);
          patch({ labPackageId: e.target.value, ...(chosen ? { unitPrice: String(chosen.price) } : {}) });
        }}>
          <option value={booking.labPackageId ?? ''}>{booking.packageName}</option>
          {tests.data?.filter((t) => String(t.id) !== booking.labPackageId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></InlineField>
        <InlineField label="Unit price (per patient)" onEditing={onEditing}><input className={fieldClass} value={draft.unitPrice} type="number" min="0" step="0.01" disabled={paid} onChange={(e) => patch({ unitPrice: e.target.value })} /></InlineField>
        <InlineField label="Scheduled for" onEditing={onEditing}><input className={fieldClass} value={draft.scheduledFor} type="datetime-local" onChange={(e) => patch({ scheduledFor: e.target.value })} /></InlineField>
        <div className="self-end py-2 text-sm">Order total: <strong>{formatCurrency(Number(draft.unitPrice || 0) * draft.patients.length)}</strong><p className="text-xs text-slate-500">Calculated from unit price × patient count.</p></div>
        <InlineField label="Order notes / instructions" onEditing={onEditing} className="sm:col-span-2"><textarea className={fieldClass} value={draft.note} rows={3} onChange={(e) => patch({ note: e.target.value })} /></InlineField>
        {(paid || booking.reportPages > 0) && <p className="text-xs text-slate-500 sm:col-span-2">{paid ? 'Collected billing keeps its original charges. Billing corrections are required before changing the test, price or patient count.' : 'Remove the attached test report before replacing the test.'}</p>}
      </section>
      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Patient details ({draft.patients.length})</h3><Button size="sm" variant="secondary" disabled={paid} type="button" onClick={() => { onEditing(); patch({ patients: [...draft.patients, blankOrderPatient()] }); }}>Add patient</Button></div>
        {draft.patients.map((patient, index) => <div key={index} className="divide-y divide-slate-100 rounded-md border p-3">
          <InlineField label="Name" onEditing={onEditing}><input className={fieldClass} value={patient.name} onChange={(e) => patchPatient(index, { name: e.target.value })} /></InlineField>
          <InlineField label="Age" onEditing={onEditing}><input className={fieldClass} type="number" min="0" max="120" value={patient.age} onChange={(e) => patchPatient(index, { age: e.target.value, dob: '' })} /></InlineField>
          <InlineField label="Date of birth" onEditing={onEditing}><input className={fieldClass} type="date" value={patient.dob} onChange={(e) => patchPatient(index, { dob: e.target.value, age: labPatientAge(e.target.value) })} /></InlineField>
          <InlineField label="Phone" onEditing={onEditing}><input className={fieldClass} inputMode="tel" maxLength={10} value={patient.phone} onChange={(e) => patchPatient(index, { phone: e.target.value })} /></InlineField>
          <InlineField label="Gender" onEditing={onEditing}><select className={fieldClass} value={patient.gender} onChange={(e) => patchPatient(index, { gender: e.target.value })}><option value="">Not provided</option>{['MALE', 'FEMALE', 'OTHER'].map((v) => <option key={v} value={v}>{v}</option>)}</select></InlineField>
          <InlineField label="Relation" onEditing={onEditing}><select className={fieldClass} value={patient.relation} onChange={(e) => patchPatient(index, { relation: e.target.value })}><option value="">Not provided</option>{['SELF', 'SPOUSE', 'CHILD', 'PARENT', 'OTHER'].map((v) => <option key={v} value={v}>{v}</option>)}</select></InlineField>
          <InlineField label="ABHA (optional)" onEditing={onEditing}><input className={fieldClass} maxLength={14} inputMode="numeric" value={patient.abhaId} onChange={(e) => patchPatient(index, { abhaId: e.target.value })} /></InlineField>
          <InlineField label="Patient collection address (optional)" onEditing={onEditing} className="sm:col-span-2"><input className={fieldClass} maxLength={500} value={patient.addressOverride} placeholder="Uses the booking collection address" onChange={(e) => patchPatient(index, { addressOverride: e.target.value })} /></InlineField>
          {draft.patients.length > 1 && <Button size="sm" variant="danger" disabled={paid} type="button" onClick={() => { onEditing(); patch({ patients: draft.patients.filter((_, i) => i !== index) }); }}>Remove patient {index + 1}</Button>}
        </div>)}
      </section>
    </fieldset>
    {(stores.error || tests.error || staff.error) && <p role="alert" className="mt-3 text-sm text-rose-600">{stores.error || tests.error || staff.error}</p>}
    <p className="mt-4 text-xs text-slate-500">Order reference {booking.code} · Booked {formatDateTime(booking.createdAt)}. Original reference and creation time are kept for the order history.</p>
  </form>;
}

interface InputProps { value?: unknown; type?: string; inputMode?: string; disabled?: boolean; children?: ReactNode }

/** The same detail row switches to its input when its pencil is pressed. */
function InlineField({ label, children, onEditing, className = '' }: {
  label: string; children: ReactElement<InputProps>; onEditing: () => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const { value, disabled, type, inputMode } = children.props;
  let display: ReactNode = value == null || value === '' ? 'Not provided' : String(value);
  if (children.type === 'select') {
    const selected = Children.toArray(children.props.children).find(option =>
      isValidElement<{ value?: unknown; children?: ReactNode }>(option) && String(option.props.value ?? '') === String(value ?? ''));
    if (isValidElement<{ children?: ReactNode }>(selected)) display = selected.props.children;
  } else if (type === 'datetime-local' && value) {
    display = formatDateTime(String(value));
  }
  return <div className={`grid gap-2 py-3 text-sm sm:grid-cols-3 ${className}`}>
    <div className="text-slate-500">{label}</div>
    <div className="flex min-w-0 items-start gap-2 sm:col-span-2">
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words font-medium text-slate-800">
        {editing ? <label><span className="sr-only">{label}</span>{children}</label> : display}
      </div>
      {!editing && inputMode === 'tel' && Boolean(value) && <>
        <a href={telHref(String(value))} aria-label={`Call ${label}`} className="rounded border p-1.5 text-slate-500"><Icon name="phone" className="h-4 w-4" /></a>
        <a href={whatsappHref(String(value))} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${label}`} className="rounded border p-1.5 text-emerald-600"><Icon name="whatsapp" className="h-4 w-4" /></a>
      </>}
      {!editing && !disabled && <button type="button" aria-label={`Edit ${label}`} title={`Edit ${label}`}
        onClick={() => { setEditing(true); onEditing(); }} className="shrink-0 rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500">
        <Icon name="edit" className="h-4 w-4" />
      </button>}
    </div>
  </div>;
}
