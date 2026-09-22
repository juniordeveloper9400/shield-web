import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

interface Withdrawal {
  id: string; code: string; name: string; phone: string;
  amount: string; earned: string; redeemed: string; pending_total: string;
  account_number: string; status: string; approved_at: string | null;
  verification_note: string | null; payment_reference: string | null;
}

export default function AgentWithdrawalsPage() {
  const { accessToken } = useAuth();
  const requests = useAsync(() => api.get<Withdrawal[]>('/v1/staff/agent-withdrawals', accessToken), [accessToken]);
  const [selected, setSelected] = useState<Withdrawal | null>(null);
  return <>
    <PageHeader title="Agent withdrawals" subtitle="Verify requests of ₹3,000 or more, approve, then record the actual payment." />
    <Button variant="secondary" className="mb-4" onClick={requests.reload}>Refresh</Button>
    {requests.loading && <p>Loading withdrawal requests…</p>}
    {requests.error && <p role="alert" className="text-red-600">{requests.error}</p>}
    {!requests.loading && !requests.error && requests.data?.length === 0 && <p>No withdrawal requests.</p>}
    <div className="space-y-3">
      {requests.data?.map(row => <div key={row.id} className="rounded-xl border bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div><strong>{row.name} · {row.code}</strong><p>{row.phone} · Request #{row.id}</p>
          <p>{formatCurrency(Number(row.amount))} · {row.status === 'PENDING' && row.approved_at ? 'Approved — awaiting payment' : row.status}</p>
          {row.verification_note && <p className="text-sm text-slate-500">{row.verification_note}</p>}
          {row.payment_reference && <p>Payment reference: {row.payment_reference}</p>}
        </div>
        {row.status === 'PENDING' && <Button onClick={() => setSelected(row)}>Review request</Button>}
      </div>)}
    </div>
    {selected && <Review key={selected.id} row={selected} token={accessToken} close={() => setSelected(null)} saved={() => { setSelected(null); requests.reload(); }} />}
  </>;
}

function Review({ row, token, close, saved }: { row: Withdrawal; token: string | null; close: () => void; saved: () => void }) {
  const [identity, setIdentity] = useState(false);
  const [earnings, setEarnings] = useState(false);
  const [account, setAccount] = useState('');
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = Number(row.amount) >= 3000 && Number(row.pending_total) <= Number(row.earned) - Number(row.redeemed);
  async function resolve(status: 'APPROVED' | 'PAID' | 'REJECTED') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api.post(`/v1/staff/agent-withdrawals/${row.id}/resolve`, {
        status, accountNumber: account, identityVerified: identity,
        earningsVerified: earnings, note, paymentReference: reference,
      }, token);
      saved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not process request. Refresh and try again.'); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="withdraw-title" className="max-w-lg w-full max-h-[90vh] overflow-auto rounded-xl bg-white p-6 space-y-4">
      <h2 id="withdraw-title" className="text-xl font-semibold">Verify {row.name}’s withdrawal</h2>
      <p>{row.code} · {row.phone} · Request #{row.id}</p>
      <dl><dt>Requested</dt><dd>{formatCurrency(Number(row.amount))}</dd>
        <dt>Total earnings / already redeemed</dt><dd>{formatCurrency(Number(row.earned))} / {formatCurrency(Number(row.redeemed))}</dd>
        <dt>Reserved for all pending requests</dt><dd>{formatCurrency(Number(row.pending_total))}</dd>
        <dt>Registered account</dt><dd>{row.account_number || 'Missing bank account'}</dd></dl>
      {!eligible && <p role="alert" className="text-red-600">Insufficient earnings or request below ₹3,000. Approval and payment are unavailable.</p>}
      {!row.approved_at ? <>
        <label className="block"><input type="checkbox" checked={identity} onChange={e => setIdentity(e.target.checked)} /> I cross-checked the agent’s identity and bank details.</label>
        <label className="block"><input type="checkbox" checked={earnings} onChange={e => setEarnings(e.target.checked)} /> I cross-checked earnings, previous payouts and pending requests.</label>
        <label className="block">Re-enter verified bank account<input className="block w-full border rounded p-2" value={account} onChange={e => setAccount(e.target.value)} autoComplete="off" /></label>
      </> : <><p>Approved on {new Date(row.approved_at).toLocaleString()}. Record payment only after completing the bank transfer.</p>
        <label className="block">Bank transfer / UTR reference<input className="block w-full border rounded p-2" value={reference} onChange={e => setReference(e.target.value)} /></label></>}
      <label className="block">Verification note / rejection reason<textarea className="block w-full border rounded p-2" value={note} onChange={e => setNote(e.target.value)} /></label>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {!row.approved_at ? <Button disabled={busy || !eligible || !identity || !earnings || !account.trim() || account.trim() !== row.account_number?.trim() || !note.trim()} onClick={() => resolve('APPROVED')}>Approve withdrawal</Button>
          : <Button disabled={busy || !eligible || !reference.trim()} onClick={() => resolve('PAID')}>Record payment</Button>}
        <Button variant="secondary" disabled={busy || !note.trim()} onClick={() => resolve('REJECTED')}>Reject request</Button>
        <Button variant="secondary" disabled={busy} onClick={close}>Close</Button>
      </div>
    </section>
  </div>;
}
