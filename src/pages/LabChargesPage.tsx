import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { calculateKmCharge, distanceRateNote } from '@/lib/labCharges';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { deleteLabCharge, listLabCharges, saveLabCharge, type LabCharge, type LabChargeInput } from '@/api/labCharges';

const defaultNote: LabChargeInput = { name: 'Home collection distance', kind: 'DISTANCE', firstKm: 3, firstAmount: 20, secondKm: 5, secondAmount: 50, extraPerKm: 15, isActive: true };
const blankKm: LabChargeInput = { name: 'Distance charge', kind: 'KM', distanceKm: 0, isActive: true };
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';
const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
const message = (e: unknown) => e instanceof Error ? e.message : 'Could not save changes.';

export default function LabChargesPage() {
  const { accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listLabCharges(accessToken), [accessToken]);
  const [draft, setDraft] = useState<LabChargeInput | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<LabCharge | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const notes = (data ?? []).filter(r => r.kind === 'DISTANCE');
  const charges = (data ?? []).filter(r => r.kind !== 'DISTANCE');
  const foundRate = notes.find(r => r.isActive);
  const rate = foundRate?.kind === 'DISTANCE' ? foundRate : null;
  const amount = draft?.kind === 'KM' ? calculateKmCharge(draft.distanceKm, rate) : null;
  const noteMode = draft?.kind === 'DISTANCE';
  function open(row?: LabCharge) { setEditingId(row?.id ?? null); setDraft(row ? { ...row } : { ...blankKm }); setFormError(null); }
  async function save() {
    if (!draft || busy) return;
    if (draft.kind === 'KM' && amount === null) { setFormError('Enter valid kilometres and configure an active rate note.'); return; }
    if (!draft.name.trim()) { setFormError('Enter a name.'); return; }
    if (draft.kind === 'DISTANCE' && (draft.secondKm <= draft.firstKm || draft.secondAmount < draft.firstAmount)) { setFormError('Distance limits must increase and charges must not decrease.'); return; }
    setBusy(true); setFormError(null);
    try {
      await saveLabCharge(editingId, draft.kind === 'KM' ? { ...draft, name: `Home collection - ${draft.distanceKm} km` } : draft, accessToken);
      setDraft(null); reload();
    } catch (e) { setFormError(message(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setFormError(null);
    try { await deleteLabCharge(deleting.id, accessToken); setDeleting(null); reload(); }
    catch (e) { setFormError(message(e)); } finally { setBusy(false); }
  }
  return <>
    <PageHeader title="Lab Charges" subtitle="Create technician fees and km charges using your saved rate note."
      actions={<Button disabled={loading || Boolean(error)} onClick={() => open()}>Create charge</Button>} />
    {error && <div role="alert" className="mb-4 text-rose-700">{error} <Button variant="secondary" onClick={reload}>Retry</Button></div>}
    {loading ? <p role="status">Loading charges...</p> : !error && <>
      <section className="mb-5 space-y-3 rounded-xl border border-blue-100 bg-blue-50 p-5">
        <h2 className="font-semibold">Home collection distance - rate note</h2>
        {notes.map(note => note.kind === 'DISTANCE' && <div key={note.id} className="space-y-2">
          <p className="text-sm text-slate-700">{distanceRateNote(note)}</p>
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-slate-500">{note.name} ({note.isActive ? 'Active' : 'Inactive'})</span>
            <Button size="sm" variant="secondary" onClick={() => open(note)}>Edit note</Button>
            <Button size="sm" variant="danger" onClick={() => { setDeleting(note); setFormError(null); }}>Delete note</Button>
          </div>
        </div>)}
        {!rate && <p className="text-sm text-amber-700">An active rate note is required to create or recalculate km charges.</p>}
        {!notes.length && <Button variant="secondary" size="sm" onClick={() => { setEditingId(null); setFormError(null); setDraft({ ...defaultNote }); }}>Add rate note</Button>}
        <p className="text-xs text-slate-500">Enter only kilometres for a km charge. Its amount is calculated from this saved note.</p>
      </section>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-500"><tr>{['Charge', 'Type', 'Distance', 'Amount', 'Status', 'Actions'].map(h => <th key={h} className="p-4">{h}</th>)}</tr></thead>
        <tbody>{charges.map(row => <tr key={row.id} className="border-t border-slate-100">
          <td className="p-4 font-medium">{row.name}</td><td className="p-4">{row.kind === 'TECHNICIAN' ? 'Technician' : 'KM charge'}</td>
          <td className="p-4">{row.kind === 'KM' ? `${row.distanceKm} km` : 'Per visit'}</td><td className="p-4">{row.amount == null ? 'Not calculated' : money(row.amount)}</td>
          <td className="p-4">{row.isActive ? 'Active' : 'Inactive'}</td><td className="p-4"><div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => open(row)}>Edit</Button><Button variant="danger" size="sm" onClick={() => { setDeleting(row); setFormError(null); }}>Delete</Button>
          </div></td>
        </tr>)}{!charges.length && <tr><td colSpan={6} className="p-6 text-slate-500">No charges yet. Create a km charge or technician fee.</td></tr>}</tbody>
      </table></div>
      <p className="mt-4 text-xs text-slate-500">Changing the note does not alter saved charges. Edit and save a km charge to recalculate it. Applying charges to orders and automatic address routing are pending.</p>
    </>}
    <Modal open={draft !== null} onClose={() => { if (!busy) setDraft(null); }} title={noteMode ? (editingId ? 'Edit rate note' : 'Add rate note') : editingId ? 'Edit charge' : 'Create charge'}
      footer={<><Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button><Button disabled={busy || (draft?.kind === 'KM' && amount === null)} form="lab-charge-form" type="submit">{busy ? 'Saving...' : noteMode ? 'Save note' : 'Save charge'}</Button></>}>
      {draft && <form id="lab-charge-form" className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="space-y-4">
          {draft.kind !== 'KM' && <label className="block text-sm">Name<input required maxLength={120} className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>}
          {!noteMode && <label className="block text-sm">Charge type<select disabled={editingId !== null} className={inputClass} value={draft.kind} onChange={e => { setFormError(null); setDraft(e.target.value === 'TECHNICIAN' ? { name: 'Technician visit', kind: 'TECHNICIAN', amount: 0, isActive: draft.isActive } : { ...blankKm, isActive: draft.isActive }); }}><option value="KM">KM charge</option><option value="TECHNICIAN">Technician fee</option></select></label>}
          {draft.kind === 'KM' && <>
            <label className="block text-sm">Distance (km)<input required autoFocus className={inputClass} type="number" min="0.01" max="10000" step="0.01" value={draft.distanceKm || ''} onChange={e => { setFormError(null); setDraft({ ...draft, distanceKm: e.target.valueAsNumber || 0 }); }} /></label>
            {rate && <p className="rounded-lg bg-blue-50 p-3 text-sm text-slate-600">{distanceRateNote(rate)}</p>}
            <div aria-live="polite" className="rounded-lg border p-4"><p className="text-sm text-slate-500">Calculated charge</p><p className="mt-1 text-xl font-semibold">{amount === null ? 'Enter kilometres' : money(amount)}</p></div>
            {!rate && <p role="alert" className="text-sm text-amber-700">Add or activate a rate note first.</p>}
          </>}
          {draft.kind === 'TECHNICIAN' && <label className="block text-sm">Technician fee (INR per visit)<input required className={inputClass} type="number" min="0" max="1000000" step="0.01" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.valueAsNumber })} /></label>}
          {draft.kind === 'DISTANCE' && (['firstKm', 'firstAmount', 'secondKm', 'secondAmount', 'extraPerKm'] as const).map((key, i) => <label className="block text-sm" key={key}>
            {['First distance limit (km)', 'Charge up to first limit (INR)', 'Second distance limit (km)', 'Charge up to second limit (INR)', 'Extra charge per started km above second limit (INR)'][i]}
            <input required className={inputClass} type="number" min={key === 'firstKm' || key === 'secondKm' ? '0.01' : '0'} max={key === 'firstKm' || key === 'secondKm' ? '10000' : '1000000'} step="0.01" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.valueAsNumber })} />
          </label>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Active</label>
        </fieldset>{formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
      </form>}
    </Modal>
    <Modal open={deleting !== null} onClose={() => { if (!busy) setDeleting(null); }} title={deleting?.kind === 'DISTANCE' ? 'Delete rate note' : 'Delete charge'}
      footer={<><Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting...' : 'Delete'}</Button></>}>
      <p>Delete {deleting?.name}? Existing saved charges, bookings and invoices will not be changed.</p>
      {deleting?.kind === 'DISTANCE' && <p className="mt-2 text-sm text-amber-700">A new active rate note is needed before any km charge can be created or recalculated.</p>}
      {formError && <p role="alert" className="mt-3 text-rose-700">{formError}</p>}
    </Modal>
  </>;
}
