import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { deleteLabCharge, listLabCharges, saveLabCharge, type LabCharge, type LabChargeInput } from '@/api/labCharges';

const distanceDefault: LabChargeInput = { name: 'Home collection distance', kind: 'DISTANCE', isActive: true,
  firstKm: 3, firstAmount: 20, secondKm: 5, secondAmount: 50, extraPerKm: 15 };
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';
const message = (e: unknown) => e instanceof Error ? e.message : 'Could not save changes.';

export default function LabChargesPage() {
  const { accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listLabCharges(accessToken), [accessToken]);
  const [draft, setDraft] = useState<LabChargeInput | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<LabCharge | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewKm, setPreviewKm] = useState('6');

  function open(row?: LabCharge) {
    setEditingId(row?.id ?? null);
    setDraft(row ? { ...row } : { ...distanceDefault });
    setFormError(null);
  }
  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) { setFormError('Enter a charge name.'); return; }
    if (draft.kind === 'DISTANCE' && (draft.secondKm <= draft.firstKm || draft.secondAmount < draft.firstAmount)) {
      setFormError('The second distance must be larger and its charge must not decrease.'); return;
    }
    setBusy(true); setFormError(null);
    try { await saveLabCharge(editingId, draft, accessToken); setDraft(null); reload(); }
    catch (e) { setFormError(message(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true); setFormError(null);
    try { await deleteLabCharge(deleting.id, accessToken); setDeleting(null); reload(); }
    catch (e) { setFormError(message(e)); } finally { setBusy(false); }
  }
  const rows = data ?? [];
  const tech = rows.find(r => r.isActive && r.kind === 'TECHNICIAN');
  const rate = rows.find(r => r.isActive && r.kind === 'DISTANCE');
  const km = Number(previewKm);
  const travel = rate?.kind === 'DISTANCE' ? km <= rate.firstKm ? rate.firstAmount
    : km <= rate.secondKm ? rate.secondAmount : rate.secondAmount + Math.ceil(Math.round((km - rate.secondKm) * 1e6) / 1e6) * rate.extraPerKm : 0;
  const technician = tech?.kind === 'TECHNICIAN' ? tech.amount : 0;
  const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  return <>
    <PageHeader title="Lab Charges" subtitle="Manage technician fees and Home Collection distance rates."
      actions={<Button onClick={() => open()}>Create charge</Button>} />
    <p className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-slate-600">
      These settings do not yet apply charges to lab orders. Automatic address-based distance and billing integration are pending.
      Distance rates use one-way kilometres, rounding each additional started kilometre up.
    </p>
    {error && <div role="alert" className="mb-4 text-rose-700">{String(error)} <Button variant="secondary" onClick={reload}>Retry</Button></div>}
    {loading ? <p role="status">Loading charges…</p> : !error && <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>
        {['Charge', 'Type', 'Rates', 'Status', 'Actions'].map(h => <th key={h} className="p-4">{h}</th>)}
      </tr></thead><tbody>
        {rows.map(row => <tr key={row.id} className="border-t border-slate-100">
          <td className="p-4 font-medium">{row.name}</td><td className="p-4">{row.kind === 'TECHNICIAN' ? 'Technician' : 'Distance'}</td>
          <td className="p-4">{row.kind === 'TECHNICIAN' ? `${money(row.amount)} per visit` :
            `Up to ${row.firstKm} km: ${money(row.firstAmount)}; over ${row.firstKm}–${row.secondKm} km: ${money(row.secondAmount)}; above ${row.secondKm} km: +${money(row.extraPerKm)}/km`}</td>
          <td className="p-4">{row.isActive ? 'Active' : 'Inactive'}</td>
          <td className="p-4"><div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => open(row)}>Edit</Button>
            <Button variant="danger" size="sm" onClick={() => { setDeleting(row); setFormError(null); }}>Delete</Button></div></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={5} className="p-6 text-slate-500">No charges configured. Create a technician fee or distance rule.</td></tr>}
      </tbody></table>
    </div>}
    {!loading && !error && <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Rate preview</h2>
      <label className="mt-3 block max-w-xs text-sm">Distance (km)
        <input className={inputClass} type="number" min="0" max="10000" step="0.1" value={previewKm} onChange={e => setPreviewKm(e.target.value)} />
      </label>
      {previewKm !== '' && Number.isFinite(km) && km >= 0 && km <= 10000 && <p className="mt-3 text-sm">
        Technician {money(technician)} + distance {money(travel)} = <strong>{money(technician + travel)}</strong> (preview only)
      </p>}
      {(!tech || !rate) && <p className="mt-2 text-sm text-slate-500">{!tech ? 'No active technician fee. ' : ''}{!rate ? 'No active distance rule.' : ''}</p>}
    </section>}
    <Modal open={draft !== null} onClose={() => { if (!busy) setDraft(null); }} title={editingId ? 'Edit charge' : 'Create charge'}
      footer={<><Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button><Button disabled={busy} form="lab-charge-form" type="submit">{busy ? 'Saving…' : 'Save charge'}</Button></>}>
      {draft && <form id="lab-charge-form" className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label className="block text-sm">Name<input required maxLength={120} className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label className="block text-sm">Charge type<select className={inputClass} value={draft.kind} onChange={e => setDraft(e.target.value === 'TECHNICIAN'
          ? { name: 'Technician visit', kind: 'TECHNICIAN', amount: 0, isActive: draft.isActive } : { ...distanceDefault, isActive: draft.isActive })}>
          <option value="TECHNICIAN">Technician fee</option><option value="DISTANCE">Distance rule</option>
        </select></label>
        {draft.kind === 'TECHNICIAN' ? <label className="block text-sm">Technician fee (₹ per visit)<input required className={inputClass} type="number" min="0" max="1000000" step="0.01" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.valueAsNumber })} /></label> :
          (['firstKm', 'firstAmount', 'secondKm', 'secondAmount', 'extraPerKm'] as const).map((key, i) => <label className="block text-sm" key={key}>
            {['First distance limit (km)', 'Charge up to first limit (₹)', 'Second distance limit (km)', 'Charge up to second limit (₹)', 'Extra charge per started km above second limit (₹)'][i]}
            <input required className={inputClass} type="number" min={key.endsWith('Km') && key !== 'extraPerKm' ? '0.01' : '0'} max={key === 'firstKm' || key === 'secondKm' ? '10000' : '1000000'} step="0.01" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.valueAsNumber })} />
          </label>)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isActive} onChange={e => setDraft({ ...draft, isActive: e.target.checked })} />Active (one rule of each type can be active)</label>
        {formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
      </form>}
    </Modal>
    <Modal open={deleting !== null} onClose={() => { if (!busy) setDeleting(null); }} title="Delete charge"
      footer={<><Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete charge'}</Button></>}>
      <p>Delete “{deleting?.name}”? Existing bookings and invoices will not be changed.</p>
      {formError && <p role="alert" className="mt-3 text-rose-700">{formError}</p>}
    </Modal>
  </>;
}
