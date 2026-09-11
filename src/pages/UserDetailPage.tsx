import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { DetailList } from '@/components/ui/DetailList';
import { PrivilegeCard } from '@/components/ui/PrivilegeCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
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
import { listMemberTransactions, moneyFlowKindLabel } from '@/api/accounts';
import { listPrescriptionsForMember } from '@/api/prescriptions';
import { PrescriptionReviewModal } from '@/components/prescriptions/PrescriptionReviewModal';
import { GEO_TIER_ORDER, listSlots, type GeoTier } from '@/api/geo';
import type {
  AgentLevel,
  GeoSlot,
  InvestorPlanType,
  MoneyFlowEntry,
  MoneyFlowKind,
  PrescriptionStatus,
} from '@/types';

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

type Tab =
  | 'overview'
  | 'patients'
  | 'addresses'
  | 'plans'
  | 'transactions'
  | 'prescriptions';

const RX_STATUS_LABEL: Record<PrescriptionStatus, string> = {
  awaiting_review: 'Awaiting review',
  read: 'Read',
  in_cart: 'In cart',
  ordered: 'Ordered',
};

const TXN_KIND_TONE: Record<MoneyFlowKind, 'blue' | 'violet' | 'green' | 'amber' | 'red'> = {
  order: 'blue',
  lab_booking: 'violet',
  appointment: 'green',
  privilege_load: 'amber',
  agent_payout: 'red',
};

const TXN_KIND_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'order', label: 'Orders' },
  { value: 'lab_booking', label: 'Lab tests' },
  { value: 'appointment', label: 'Appointments' },
  { value: 'privilege_load', label: 'Privilege plan loads' },
  { value: 'agent_payout', label: 'Agent payouts' },
];

const TXN_DIRECTION_OPTIONS = [
  { value: 'all', label: 'In & out' },
  { value: 'in', label: 'Money in' },
  { value: 'out', label: 'Money out' },
];

const TXN_COLUMNS: Column<MoneyFlowEntry>[] = [
  { key: 'when', header: 'Date', render: (row) => formatDateTime(row.occurredAt) },
  {
    key: 'type',
    header: 'Type',
    render: (row) => (
      <Badge tone={TXN_KIND_TONE[row.kind]}>{moneyFlowKindLabel(row.kind)}</Badge>
    ),
  },
  {
    key: 'ref',
    header: 'Reference',
    render: (row) => (
      <div>
        <p className="text-slate-800">{row.label}</p>
        <p className="text-xs text-slate-400">{row.detail}</p>
      </div>
    ),
  },
  {
    key: 'direction',
    header: 'Flow',
    render: (row) => (
      <Badge tone={row.direction === 'in' ? 'green' : 'red'}>
        {row.direction === 'in' ? 'In' : 'Out'}
      </Badge>
    ),
  },
  {
    key: 'amount',
    header: 'Amount',
    render: (row) => (
      <span
        className={`font-semibold ${row.direction === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}
      >
        {row.direction === 'in' ? '+' : '−'}
        {formatCurrency(row.amount)}
      </span>
    ),
    className: 'text-right',
  },
];

export default function UserDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const user = useAsync(() => getUser(id), [id]);
  const detail = useAsync(() => getUserDetail(id), [id]);
  const agents = useAsync(listAgentOptions, []);
  const plans = useAsync(() => listActivationsForMember(id), [id]);
  const transactions = useAsync(() => listMemberTransactions(id), [id]);
  const prescriptions = useAsync(() => listPrescriptionsForMember(id), [id]);
  const selected = user.data;
  const planRows = plans.data ?? [];
  const headlinePlan = planRows.find((p) => p.status === 'approved') ?? planRows[0];
  const txnRows = transactions.data ?? [];
  const rxRows = prescriptions.data ?? [];

  const [tab, setTab] = useState<Tab>('overview');
  const [mode, setMode] = useState<'view' | 'agent' | 'investor'>('view');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Confirm step for dropping an agent / investor back to a plain member — the
  // delete cascades their downline, payouts and plan-change requests.
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // The prescription open in the review modal, for the Prescriptions tab.
  const [selectedRxId, setSelectedRxId] = useState<string | null>(null);
  const selectedRx = rxRows.find((r) => r.id === selectedRxId) ?? null;

  // Transaction history filters
  const [txnSearch, setTxnSearch] = useState('');
  const [txnKind, setTxnKind] = useState('all');
  const [txnDirection, setTxnDirection] = useState('all');
  const filteredTxns = useMemo(() => {
    const q = txnSearch.trim().toLowerCase();
    return txnRows.filter((row) => {
      const matchesQuery =
        !q ||
        row.label.toLowerCase().includes(q) ||
        row.detail.toLowerCase().includes(q);
      const matchesKind = txnKind === 'all' || row.kind === txnKind;
      const matchesDirection = txnDirection === 'all' || row.direction === txnDirection;
      return matchesQuery && matchesKind && matchesDirection;
    });
  }, [txnRows, txnSearch, txnKind, txnDirection]);
  const txnTotals = useMemo(
    () =>
      txnRows.reduce(
        (acc, row) => {
          if (row.direction === 'in') acc.in += row.amount;
          else acc.out += row.amount;
          return acc;
        },
        { in: 0, out: 0 },
      ),
    [txnRows],
  );

  // Agent form
  const [level, setLevel] = useState<AgentLevel>('ward');
  const [parentId, setParentId] = useState('');

  // The named slot (region → … → ward) this agent will head. Every level
  // below national is required to pick one — the same rule the app's own
  // registration screen enforces — so a converted agent locks into a real
  // position in the team tree instead of floating with no area at all.
  const emptyChain: Record<GeoTier, string> = {
    region: '',
    state: '',
    district: '',
    assembly: '',
    lsgd: '',
    ward: '',
  };
  const [chain, setChain] = useState<Record<GeoTier, string>>(emptyChain);
  const [chainOptions, setChainOptions] = useState<Record<GeoTier, GeoSlot[]>>({
    region: [],
    state: [],
    district: [],
    assembly: [],
    lsgd: [],
    ward: [],
  });

  // The tiers this level's picker needs, in order — none for national, just
  // "region" for a region agent, "region, state" for a state agent, and so on.
  const neededTiers = useMemo<GeoTier[]>(
    () =>
      level === 'national'
        ? []
        : GEO_TIER_ORDER.slice(0, GEO_TIER_ORDER.indexOf(level as GeoTier) + 1),
    [level],
  );

  /** Sets [tier]'s pick and clears everything below it — its own children's
   *  options are no longer valid once the tier they hang off changes. */
  function pickTier(tier: GeoTier, value: string) {
    setChain((prev) => {
      const next = { ...prev, [tier]: value };
      GEO_TIER_ORDER.slice(GEO_TIER_ORDER.indexOf(tier) + 1).forEach((t) => {
        next[t] = '';
      });
      return next;
    });
  }

  // A different level needs a differently-shaped chain — start clean.
  useEffect(() => {
    setChain(emptyChain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  useEffect(() => {
    if (!neededTiers.includes('region')) return;
    listSlots('region', null).then((opts) =>
      setChainOptions((prev) => ({ ...prev, region: opts })),
    );
  }, [neededTiers]);
  useEffect(() => {
    if (!neededTiers.includes('state')) return;
    if (!chain.region) {
      setChainOptions((prev) => ({ ...prev, state: [] }));
      return;
    }
    listSlots('state', chain.region).then((opts) =>
      setChainOptions((prev) => ({ ...prev, state: opts })),
    );
  }, [neededTiers, chain.region]);
  useEffect(() => {
    if (!neededTiers.includes('district')) return;
    if (!chain.state) {
      setChainOptions((prev) => ({ ...prev, district: [] }));
      return;
    }
    listSlots('district', chain.state).then((opts) =>
      setChainOptions((prev) => ({ ...prev, district: opts })),
    );
  }, [neededTiers, chain.state]);
  useEffect(() => {
    if (!neededTiers.includes('assembly')) return;
    if (!chain.district) {
      setChainOptions((prev) => ({ ...prev, assembly: [] }));
      return;
    }
    listSlots('assembly', chain.district).then((opts) =>
      setChainOptions((prev) => ({ ...prev, assembly: opts })),
    );
  }, [neededTiers, chain.district]);
  useEffect(() => {
    if (!neededTiers.includes('lsgd')) return;
    if (!chain.assembly) {
      setChainOptions((prev) => ({ ...prev, lsgd: [] }));
      return;
    }
    listSlots('lsgd', chain.assembly).then((opts) =>
      setChainOptions((prev) => ({ ...prev, lsgd: opts })),
    );
  }, [neededTiers, chain.assembly]);
  useEffect(() => {
    if (!neededTiers.includes('ward')) return;
    if (!chain.lsgd) {
      setChainOptions((prev) => ({ ...prev, ward: [] }));
      return;
    }
    listSlots('ward', chain.lsgd).then((opts) =>
      setChainOptions((prev) => ({ ...prev, ward: opts })),
    );
  }, [neededTiers, chain.lsgd]);

  // What the agent heads: the id/name of the slot at their own level — null
  // for national, which has none.
  const areaTier = level === 'national' ? null : (level as GeoTier);
  const areaId = areaTier ? chain[areaTier] || null : null;
  const areaName =
    areaTier && areaId
      ? chainOptions[areaTier].find((s) => s.id === areaId)?.name ?? ''
      : '';

  // Top of the tree is capped: one national agent, six regions. Counts come
  // from the agent list the parent picker already loads.
  const agentTierCounts = useMemo(() => {
    const rows = agents.data ?? [];
    return {
      national: rows.filter((a) => a.level === 'national').length,
      region: rows.filter((a) => a.level === 'region').length,
    };
  }, [agents.data]);
  const nationalFull = agentTierCounts.national >= 1;
  const regionFull = agentTierCounts.region >= 6;
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
    if (level === 'national' && nationalFull) {
      setFormError('There is already a national agent — only one is allowed.');
      return;
    }
    if (level === 'region' && regionFull) {
      setFormError(
        'All six regions already have an agent — no more region agents can be added.',
      );
      return;
    }
    // Every level below national heads a real, named slot — same as the
    // app's own registration screen. Refuse to submit until the whole chain
    // down to this agent's own tier is picked.
    const missing = neededTiers.find((tier) => !chain[tier]);
    if (missing) {
      setFormError(`Choose which ${missing} this agent heads.`);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const code = await convertToAgent(id, {
        level,
        parentId: parentId || null,
        area: areaName,
        areaId,
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
      setConfirmRevoke(false);
      // Stay on the page so the persona badge flips to "Member" in place.
      user.reload();
      detail.reload();
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
          <>
            {selected && mode === 'view' && (
              <>
                {selected.persona === 'member' ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!selected.registered}
                      title={
                        selected.registered
                          ? undefined
                          : 'Member must complete registration first'
                      }
                      onClick={() => setMode('investor')}
                    >
                      Switch to investor
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!selected.registered}
                      title={
                        selected.registered
                          ? undefined
                          : 'Member must complete registration first'
                      }
                      onClick={() => setMode('agent')}
                    >
                      Switch to agent
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={saving}
                    onClick={() => {
                      setFormError(null);
                      setConfirmRevoke(true);
                    }}
                  >
                    Switch to member
                  </Button>
                )}
              </>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={back}
              aria-label="Back to users"
              title="Back to users"
            >
              ←
            </Button>
          </>
        }
      />

      {user.loading ? (
        <Card className="p-5">
          <p className="py-14 text-center text-sm text-slate-400">Loading…</p>
        </Card>
      ) : user.error ? (
        <Card className="p-5">
          <p className="py-14 text-center text-sm text-rose-500">{user.error}</p>
        </Card>
      ) : !selected ? (
        <Card className="p-5">
          <p className="py-14 text-center text-sm text-slate-400">
            This member could not be found.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
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

          {selected.persona === 'member' && !selected.registered && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              This member has not completed registration yet, so they cannot be
              converted to an agent or investor. The Switch buttons unlock once
              registration is done.
            </p>
          )}

          {detail.error && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Could not load this member's full profile.
            </p>
          )}

          {mode === 'view' && (
            <>
              <Tabs
                items={[
                  { key: 'overview', label: 'Overview' },
                  {
                    key: 'patients',
                    label: 'Patient details',
                    count: detail.data?.patients.length,
                  },
                  {
                    key: 'addresses',
                    label: 'Address details',
                    count: detail.data?.addresses.length,
                  },
                  { key: 'plans', label: 'Plan details', count: planRows.length },
                  {
                    key: 'prescriptions',
                    label: 'Prescriptions',
                    count: rxRows.length,
                  },
                  {
                    key: 'transactions',
                    label: 'Transaction history',
                    count: txnRows.length,
                  },
                ]}
                active={tab}
                onChange={(key) => setTab(key as Tab)}
              />

              {tab === 'overview' && (
                <div className="space-y-6">
                  {/* The plan leads the tab — it's the figure a support call
                      or a follow-up almost always starts from. */}
                  <Card>
                    <CardHeader
                      title="Activate plan"
                      subtitle="The privilege card currently active on this account."
                      action={
                        planRows.length > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setTab('plans')}
                          >
                            View all →
                          </Button>
                        )
                      }
                    />
                    <div className="p-5">
                      {plans.loading ? (
                        <p className="text-sm text-slate-400">Loading…</p>
                      ) : !headlinePlan ? (
                        <p className="text-sm text-slate-400">
                          No privilege plan activated.
                        </p>
                      ) : (
                        <div className="max-w-xs">
                          <button
                            type="button"
                            onClick={() => navigate(`/activations/${headlinePlan.id}`)}
                            className="group block text-left"
                          >
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
                              className="transition group-hover:-translate-y-0.5 group-hover:shadow-lg"
                            />
                          </button>
                          {headlinePlan.status === 'pending' && (
                            <p className="mt-2 text-xs font-medium text-amber-700">
                              Awaiting review — tap the card to approve or reject it.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>

                  <Card>
                    <CardHeader
                      title="Registration details"
                      subtitle="Account and registration details."
                    />
                    <div className="p-5">
                      <DetailList rows={detailRows} />
                    </div>
                  </Card>
                </div>
              )}

              {tab === 'patients' && (
                <Card>
                  <CardHeader
                    title={`Patients${
                      detail.data && detail.data.patients.length > 0
                        ? ` (${detail.data.patients.length})`
                        : ''
                    }`}
                    subtitle="People this member has added to the app."
                  />
                  <div className="p-5">
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
                </Card>
              )}

              {tab === 'addresses' && (
                <Card>
                  <CardHeader
                    title={`Addresses${
                      detail.data && detail.data.addresses.length > 0
                        ? ` (${detail.data.addresses.length})`
                        : ''
                    }`}
                    subtitle="Saved delivery addresses on this account."
                  />
                  <div className="p-5">
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
                </Card>
              )}

              {tab === 'plans' && (
                <Card>
                  <CardHeader
                    title={`Privilege plans${
                      planRows.length > 0 ? ` (${planRows.length})` : ''
                    }`}
                    subtitle="Cards this member has activated, newest first."
                    action={
                      planRows.length > 0 && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate(`/activations/member/${id}`)}
                        >
                          Full plans page →
                        </Button>
                      )
                    }
                  />
                  <div className="p-5">
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
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/activations/${headlinePlan.id}`)
                              }
                              className="group block text-left"
                            >
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
                                className="transition group-hover:-translate-y-0.5 group-hover:shadow-lg"
                              />
                            </button>
                          </div>
                        )}
                        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                          {planRows.map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                onClick={() => navigate(`/activations/${p.id}`)}
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-slate-50"
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
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {tab === 'prescriptions' && (
                <Card>
                  <CardHeader
                    title={`Prescriptions${rxRows.length > 0 ? ` (${rxRows.length})` : ''}`}
                    subtitle="Scripts this member has uploaded — open one to see the script and send or update its intake card."
                  />
                  <div className="p-5">
                    {prescriptions.loading ? (
                      <p className="text-sm text-slate-400">Loading…</p>
                    ) : rxRows.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        No prescriptions uploaded.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {rxRows.map((rx) => (
                          <button
                            key={rx.id}
                            type="button"
                            onClick={() => setSelectedRxId(rx.id)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left text-sm transition hover:border-brand-300 hover:bg-slate-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-800">
                                {rx.code} · {rx.patientName}
                              </span>
                              <span className="text-xs text-slate-400">
                                {rx.doctor || 'No doctor named'} ·{' '}
                                {formatDateTime(rx.createdAt)}
                              </span>
                            </span>
                            <Badge tone={toneForStatus(rx.status)}>
                              {RX_STATUS_LABEL[rx.status]}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {tab === 'transactions' && (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Card className="p-4">
                      <p className="text-xs text-slate-500">Money in</p>
                      <p className="mt-1 text-xl font-semibold text-emerald-600">
                        {formatCurrency(txnTotals.in)}
                      </p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs text-slate-500">Money out</p>
                      <p className="mt-1 text-xl font-semibold text-rose-600">
                        {formatCurrency(txnTotals.out)}
                      </p>
                    </Card>
                    <Card className="p-4">
                      <p className="text-xs text-slate-500">Net</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">
                        {formatCurrency(txnTotals.in - txnTotals.out)}
                      </p>
                    </Card>
                  </div>

                  <Card>
                    <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          Transaction history
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Every order, lab test, appointment, plan load and agent
                          payout on this account, one timeline.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <SearchInput
                          value={txnSearch}
                          onChange={setTxnSearch}
                          placeholder="Search reference…"
                        />
                        <FilterSelect
                          value={txnKind}
                          onChange={setTxnKind}
                          options={TXN_KIND_OPTIONS}
                        />
                        <FilterSelect
                          value={txnDirection}
                          onChange={setTxnDirection}
                          options={TXN_DIRECTION_OPTIONS}
                        />
                      </div>
                    </div>
                    <DataTable<MoneyFlowEntry>
                      columns={TXN_COLUMNS}
                      rows={filteredTxns}
                      loading={transactions.loading}
                      error={transactions.error}
                      empty="No transactions match your filters."
                    />
                  </Card>
                </div>
              )}
            </>
          )}

          {mode === 'agent' && (
            <Card className="p-5">
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
                    {AGENT_LEVELS.map((l) => {
                      const full =
                        (l === 'national' && nationalFull) ||
                        (l === 'region' && regionFull);
                      return (
                        <option key={l} value={l} disabled={full}>
                          {titleCase(l)}
                          {full ? ' — already filled' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {(nationalFull || regionFull) && (
                    <span className="mt-1 block text-xs font-normal normal-case text-slate-400">
                      {nationalFull && 'A national agent already exists. '}
                      {regionFull && 'All six regions are taken. '}
                      Those levels can't be assigned again.
                    </span>
                  )}
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
                {neededTiers.length > 0 && (
                  <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Position — the named slot this agent heads
                    </p>
                    {neededTiers.map((tier, i) => {
                      const parentTier = i > 0 ? neededTiers[i - 1] : null;
                      const locked = parentTier != null && !chain[parentTier];
                      return (
                        <label
                          key={tier}
                          className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
                        >
                          {titleCase(tier)}
                          <select
                            value={chain[tier]}
                            onChange={(e) => pickTier(tier, e.target.value)}
                            disabled={locked}
                            className={`mt-1 ${fieldCls} disabled:bg-slate-50 disabled:text-slate-400`}
                          >
                            <option value="">
                              {locked
                                ? `Choose a ${parentTier} first`
                                : `Pick a ${tier}`}
                            </option>
                            {chainOptions[tier].map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                                {s.code ? ` (${s.code})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="secondary" onClick={() => setMode('view')}>
                    Back
                  </Button>
                  <Button variant="primary" disabled={saving} onClick={doConvertAgent}>
                    Convert to agent
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {mode === 'investor' && (
            <Card className="p-5">
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
            </Card>
          )}

          {formError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </p>
          )}

          <PrescriptionReviewModal
            prescription={selectedRx}
            onClose={() => setSelectedRxId(null)}
            onSaved={prescriptions.reload}
          />

          <Modal
            open={confirmRevoke}
            onClose={() => {
              if (!saving) setConfirmRevoke(false);
            }}
            title={`Switch ${selected.name} back to member?`}
            footer={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => setConfirmRevoke(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={saving}
                  onClick={doRevoke}
                >
                  {saving
                    ? 'Switching…'
                    : `Yes, remove ${titleCase(selected.persona)} access`}
                </Button>
              </>
            }
          >
            <div className="space-y-3 text-sm text-slate-600">
              <p>
                This removes the{' '}
                <span className="font-medium text-slate-800">
                  {titleCase(selected.persona)}
                </span>{' '}
                role. The app login and member profile are kept — only the{' '}
                {selected.persona} portal and the records below go.
              </p>
              {selected.persona === 'agent' ? (
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    Agent code{' '}
                    <span className="font-medium text-slate-800">
                      {selected.agentCode || '—'}
                    </span>{' '}
                    is released; re-converting later issues a new one.
                  </li>
                  <li>
                    Every customer they onboarded, and those customers' plan
                    records, are deleted.
                  </li>
                  <li>
                    Their withdrawal requests and commission-transfer history are
                    deleted.
                  </li>
                  <li>Any sub-agents under them move to the top of the tree.</li>
                </ul>
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    Investor code{' '}
                    <span className="font-medium text-slate-800">
                      {selected.investorCode || '—'}
                    </span>{' '}
                    is released; re-converting later issues a new one.
                  </li>
                  <li>
                    Their unit holding, ROI and any plan-change requests are
                    deleted.
                  </li>
                </ul>
              )}
              <p className="font-medium text-rose-600">This cannot be undone.</p>
              {formError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">
                  {formError}
                </p>
              )}
            </div>
          </Modal>
        </div>
      )}
    </>
  );
}
