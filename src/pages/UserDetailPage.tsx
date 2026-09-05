import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { PrivilegeCard } from '@/components/ui/PrivilegeCard';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  titleCase,
  toneForStatus,
} from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  getUser,
  getUserDetail,
  listAgentOptions,
  convertToAgent,
  convertToInvestor,
  revokePersona,
} from '@/api/users';
import { listActivationsForMember } from '@/api/activations';
import type { AgentLevel, InvestorPlanType } from '@/types';

const AGENT_LEVELS: AgentLevel[] = [
  'national',
  'region',
  'state',
  'district',
  'assembly',
  'lsgd',
  'ward',
];

const PERSONA_TONE = { member: 'gray', agent: 'green', investor: 'violet' } as const;

const fieldCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500';

export default function UserDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const user = useAsync(() => getUser(id), [id]);
  const detail = useAsync(() => getUserDetail(id), [id]);
  const agents = useAsync(listAgentOptions, []);
  const plans = useAsync(() => listActivationsForMember(id), [id]);
  const selected = user.data;
  const planRows = plans.data ?? [];
  const headlinePlan = planRows.find((p) => p.status === 'approved') ?? planRows[0];

  const [mode, setMode] = useState<'view' | 'agent' | 'investor'>('view');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Agent form
  const [level, setLevel] = useState<AgentLevel>('ward');
  const [parentId, setParentId] = useState('');
  const [area, setArea] = useState('');
  // Investor form
  const [storeCode, setStoreCode] = useState('');
  const [units, setUnits] = useState('1');
  const [unitPrice, setUnitPrice] = useState('150000');
  const [roi, setRoi] = useState('0');
  const [planType, setPlanType] = useState<InvestorPlanType>('yearly');

  const back = () => navigate('/users');

  const detailRows = useMemo(() => {
    if (!selected) return [];
    const d = detail.data;
    return [
      { label: 'Phone', value: selected.phone },
      { label: 'Email', value: selected.email || '—' },
      { label: 'Gender', value: d?.gender ? titleCase(d.gender) : '—' },
      { label: 'Date of birth', value: d?.dob ? formatDate(d.dob) : '—' },
      {
        label: 'Address',
        value: [d?.address, d?.place].filter(Boolean).join(', ') || '—',
      },
      {
        label: 'Pincode / State',
        value: [d?.pincode, d?.state].filter(Boolean).join(' · ') || '—',
      },
      { label: 'Home branch', value: selected.homeStoreName },
      {
        label: 'Reward points',
        value: detail.loading ? '…' : String(d?.rewardPoints ?? 0),
      },
      { label: 'Referral code', value: d?.referralCode || '—' },
      {
        label: 'Referred by',
        value: d?.referredByName
          ? `${d.referredByName}${d.referredByPhone ? ` · ${d.referredByPhone}` : ''}`
          : '—',
      },
      {
        label: 'Registered',
        value: selected.registered
          ? d?.registrationCompletedAt
            ? formatDateTime(d.registrationCompletedAt)
            : 'Yes'
          : 'No',
      },
      {
        label: 'Last login',
        value: selected.lastLoginAt ? formatDateTime(selected.lastLoginAt) : '—',
      },
      { label: 'Joined', value: formatDateTime(selected.createdAt) },
      ...(selected.persona === 'agent'
        ? [
            { label: 'Agent code', value: selected.agentCode },
            { label: 'Level', value: titleCase(selected.agentLevel || '—') },
          ]
        : []),
      ...(selected.persona === 'investor'
        ? [{ label: 'Investor code', value: selected.investorCode }]
        : []),
    ];
  }, [selected, detail.data, detail.loading]);

  async function doConvertAgent() {
    setSaving(true);
    setFormError(null);
    try {
      const code = await convertToAgent(id, {
        level,
        parentId: parentId || null,
        area: area.trim(),
      });
      if (!code) {
        setFormError('This user already has a persona.');
        user.reload();
        return;
      }
      back();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not convert.');
    } finally {
      setSaving(false);
    }
  }

  async function doConvertInvestor() {
    const n = Number(units);
    const p = Number(unitPrice);
    const r = Number(roi);
    if (!Number.isFinite(n) || n < 1) return setFormError('Units must be 1 or more.');
    if (!Number.isFinite(p) || p <= 0) return setFormError('Unit price must be positive.');
    if (!Number.isFinite(r) || r < 0) return setFormError('ROI cannot be negative.');
    setSaving(true);
    setFormError(null);
    try {
      const code = await convertToInvestor(id, {
        storeCode: storeCode.trim() || null,
        totalUnits: n,
        unitPrice: p,
        roiPercent: r,
        planType,
      });
      if (!code) {
        setFormError('This user already has a persona.');
        user.reload();
        return;
      }
      back();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not convert.');
    } finally {
      setSaving(false);
    }
  }

  async function doRevoke() {
    setSaving(true);
    setFormError(null);
    try {
      await revokePersona(id);
      back();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not revoke.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={selected ? selected.name : 'Member'}
        subtitle="App member profile, and agent / investor conversion."
        actions={
          <Button variant="secondary" size="sm" onClick={back}>
            ← Back to users
          </Button>
        }
      />

      <Card className="p-5">
        {user.loading ? (
          <p className="py-14 text-center text-sm text-slate-400">Loading…</p>
        ) : user.error ? (
          <p className="py-14 text-center text-sm text-rose-500">{user.error}</p>
        ) : !selected ? (
          <p className="py-14 text-center text-sm text-slate-400">
            This member could not be found.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={PERSONA_TONE[selected.persona]}>
                {titleCase(selected.persona)}
                {selected.persona === 'agent' && selected.agentCode
                  ? ` · ${selected.agentCode}`
                  : ''}
                {selected.persona === 'investor' && selected.investorCode
                  ? ` · ${selected.investorCode}`
                  : ''}
              </Badge>
            </div>

            {mode === 'view' && (
              <>
                <DetailList rows={detailRows} />

                <div className="mt-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Patients{' '}
                    {detail.data && detail.data.patients.length > 0
                      ? `(${detail.data.patients.length})`
                      : ''}
                  </p>
                  {detail.loading ? (
                    <p className="text-sm text-slate-400">Loading…</p>
                  ) : !detail.data || detail.data.patients.length === 0 ? (
                    <p className="text-sm text-slate-400">No patients added.</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.data.patients.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-lg border border-slate-200 p-3 text-sm"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-800">
                              {p.name}
                            </span>
                            <span className="text-xs text-slate-400">
                              {titleCase(p.relation || 'self')}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {[
                              p.gender ? titleCase(p.gender) : '',
                              p.dob ? formatDate(p.dob) : '',
                              p.phone,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </p>
                          {p.abhaId && (
                            <p className="mt-0.5 text-xs text-slate-400">
                              ABHA: {p.abhaId}
                            </p>
                          )}
                          {p.address && (
                            <p className="mt-0.5 text-xs text-slate-400">
                              {p.address}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Addresses{' '}
                    {detail.data && detail.data.addresses.length > 0
                      ? `(${detail.data.addresses.length})`
                      : ''}
                  </p>
                  {detail.loading ? (
                    <p className="text-sm text-slate-400">Loading…</p>
                  ) : !detail.data || detail.data.addresses.length === 0 ? (
                    <p className="text-sm text-slate-400">No addresses added.</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.data.addresses.map((a) => (
                        <div
                          key={a.id}
                          className="rounded-lg border border-slate-200 p-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                              {a.label || 'home'}
                            </span>
                            {a.isDefault && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-600">
                                Default
                              </span>
                            )}
                            {a.receiver && (
                              <span className="font-medium text-slate-800">
                                {a.receiver}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            {[
                              a.house,
                              a.area,
                              a.landmark,
                              [a.city, a.state].filter(Boolean).join(', '),
                              a.pincode,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {[a.phone, a.patientName ? `for ${a.patientName}` : '']
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Privilege plans{' '}
                      {planRows.length > 0 ? `(${planRows.length})` : ''}
                    </p>
                    {planRows.length > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`/activations/member/${id}`)}
                      >
                        More →
                      </Button>
                    )}
                  </div>
                  {plans.loading ? (
                    <p className="text-sm text-slate-400">Loading…</p>
                  ) : planRows.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      No privilege plan activated.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {headlinePlan && (
                        <div className="max-w-xs">
                          <PrivilegeCard
                            tierKind={headlinePlan.tierKind}
                            tierName={headlinePlan.tier}
                            cardNumber={headlinePlan.cardNumber}
                            holder={headlinePlan.memberName}
                            amount={headlinePlan.amount}
                            bonus={headlinePlan.bonus}
                            status={titleCase(headlinePlan.status)}
                            footNote={
                              headlinePlan.expiresOn
                                ? `Expires ${formatDate(headlinePlan.expiresOn)}`
                                : undefined
                            }
                          />
                        </div>
                      )}
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                        {planRows.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-800">
                                {p.tier} · {formatCurrency(p.amount)}
                              </span>
                              <span className="text-xs text-slate-400">
                                {p.cardNumber || '—'} · {formatDate(p.submittedAt)}
                              </span>
                            </span>
                            <Badge tone={toneForStatus(p.status)}>
                              {titleCase(p.status)}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {detail.error && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Could not load this member's full profile.
                  </p>
                )}

                <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                  {selected.persona === 'member' ? (
                    <>
                      <Button variant="secondary" onClick={() => setMode('investor')}>
                        Make investor
                      </Button>
                      <Button variant="primary" onClick={() => setMode('agent')}>
                        Make agent
                      </Button>
                    </>
                  ) : (
                    <Button variant="danger" disabled={saving} onClick={doRevoke}>
                      Revoke {titleCase(selected.persona)} — back to member
                    </Button>
                  )}
                </div>
              </>
            )}

            {mode === 'agent' && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  Convert to agent
                </h3>
                <p className="text-sm text-slate-500">
                  A new <span className="font-medium text-slate-700">SHD-AGT</span>{' '}
                  code is generated. The user keeps the app and gains the agent
                  portal (in-app and in the web console) on next sign-in.
                </p>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Level
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as AgentLevel)}
                    className={`mt-1 ${fieldCls}`}
                  >
                    {AGENT_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {titleCase(l)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Parent agent{' '}
                  <span className="font-normal text-slate-400">— optional</span>
                  <select
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                    className={`mt-1 ${fieldCls}`}
                  >
                    <option value="">(top of tree)</option>
                    {(agents.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name} ({titleCase(a.level)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Area <span className="font-normal text-slate-400">— optional</span>
                  <input
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    className={`mt-1 ${fieldCls}`}
                    placeholder="e.g. Melattur ward"
                  />
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="secondary" onClick={() => setMode('view')}>
                    Back
                  </Button>
                  <Button variant="primary" disabled={saving} onClick={doConvertAgent}>
                    Convert to agent
                  </Button>
                </div>
              </div>
            )}

            {mode === 'investor' && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  Convert to investor
                </h3>
                <p className="text-sm text-slate-500">
                  A new <span className="font-medium text-slate-700">SHD-INV</span>{' '}
                  code is generated. The user keeps the app and gains the investor
                  portal on next sign-in.
                </p>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Invested branch{' '}
                  <span className="font-normal text-slate-400">— code, optional</span>
                  <input
                    value={storeCode}
                    onChange={(e) => setStoreCode(e.target.value.toUpperCase())}
                    className={`mt-1 ${fieldCls}`}
                    placeholder="SHD-MEL"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Units
                    <input
                      type="number"
                      min={1}
                      value={units}
                      onChange={(e) => setUnits(e.target.value)}
                      className={`mt-1 ${fieldCls}`}
                    />
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Unit price (₹)
                    <input
                      type="number"
                      min={1}
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      className={`mt-1 ${fieldCls}`}
                    />
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    ROI %
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={roi}
                      onChange={(e) => setRoi(e.target.value)}
                      className={`mt-1 ${fieldCls}`}
                    />
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Plan
                    <select
                      value={planType}
                      onChange={(e) =>
                        setPlanType(e.target.value as InvestorPlanType)
                      }
                      className={`mt-1 ${fieldCls}`}
                    >
                      <option value="yearly">Yearly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="secondary" onClick={() => setMode('view')}>
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    disabled={saving}
                    onClick={doConvertInvestor}
                  >
                    Convert to investor
                  </Button>
                </div>
              </div>
            )}

            {formError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {formError}
              </p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
