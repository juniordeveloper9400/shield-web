import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DetailList } from '@/components/ui/DetailList';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatDateTime, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  listUsers,
  listAgentOptions,
  convertToAgent,
  convertToInvestor,
  revokePersona,
} from '@/api/users';
import type { AgentLevel, AppUser, InvestorPlanType } from '@/types';

const PERSONA_OPTIONS = [
  { value: 'all', label: 'All personas' },
  { value: 'member', label: 'Members' },
  { value: 'agent', label: 'Agents' },
  { value: 'investor', label: 'Investors' },
];

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

export default function UsersPage() {
  const { data, loading, error, reload } = useAsync(listUsers, []);
  const agents = useAsync(listAgentOptions, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [persona, setPersona] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !q ||
        row.name.toLowerCase().includes(q) ||
        row.phone.includes(q) ||
        row.email.toLowerCase().includes(q) ||
        row.agentCode.toLowerCase().includes(q) ||
        row.investorCode.toLowerCase().includes(q);
      const matchesPersona = persona === 'all' || row.persona === persona;
      return matchesQuery && matchesPersona;
    });
  }, [rows, search, persona]);

  const counts = {
    total: rows.length,
    agents: rows.filter((r) => r.persona === 'agent').length,
    investors: rows.filter((r) => r.persona === 'investor').length,
    registered: rows.filter((r) => r.registered).length,
  };

  function openUser(id: string) {
    setSelectedId(id);
    setMode('view');
    setFormError(null);
    setLevel('ward');
    setParentId('');
    setArea('');
    setStoreCode('');
    setUnits('1');
    setUnitPrice('150000');
    setRoi('0');
    setPlanType('yearly');
  }

  async function doConvertAgent(user: AppUser) {
    setSaving(true);
    setFormError(null);
    try {
      const code = await convertToAgent(user.id, {
        level,
        parentId: parentId || null,
        area: area.trim(),
      });
      if (!code) {
        setFormError('This user already has a persona — reloading.');
      }
      setSelectedId(null);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not convert.');
    } finally {
      setSaving(false);
    }
  }

  async function doConvertInvestor(user: AppUser) {
    const n = Number(units);
    const p = Number(unitPrice);
    const r = Number(roi);
    if (!Number.isFinite(n) || n < 1) return setFormError('Units must be 1 or more.');
    if (!Number.isFinite(p) || p <= 0) return setFormError('Unit price must be positive.');
    if (!Number.isFinite(r) || r < 0) return setFormError('ROI cannot be negative.');
    setSaving(true);
    setFormError(null);
    try {
      const code = await convertToInvestor(user.id, {
        storeCode: storeCode.trim() || null,
        totalUnits: n,
        unitPrice: p,
        roiPercent: r,
        planType,
      });
      if (!code) {
        setFormError('This user already has a persona — reloading.');
      }
      setSelectedId(null);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not convert.');
    } finally {
      setSaving(false);
    }
  }

  async function doRevoke(user: AppUser) {
    setSaving(true);
    setFormError(null);
    try {
      await revokePersona(user.id);
      setSelectedId(null);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not revoke.');
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<AppUser>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-400">
            {row.phone}
            {row.email ? ` · ${row.email}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'persona',
      header: 'Persona',
      render: (row) => (
        <Badge tone={PERSONA_TONE[row.persona]}>
          {titleCase(row.persona)}
          {row.persona === 'agent' && row.agentCode ? ` · ${row.agentCode}` : ''}
          {row.persona === 'investor' && row.investorCode
            ? ` · ${row.investorCode}`
            : ''}
        </Badge>
      ),
    },
    { key: 'branch', header: 'Home branch', render: (row) => row.homeStoreName },
    {
      key: 'registered',
      header: 'Registered',
      render: (row) => (row.registered ? 'Yes' : '—'),
    },
    {
      key: 'joined',
      header: 'Joined',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => openUser(row.id)}>
          Manage
        </Button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="App members, and converting them to an agent or investor persona."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Members" value={counts.total} icon="users" tone="blue" />
        <StatCard label="Registered" value={counts.registered} icon="check" tone="green" />
        <StatCard label="Agents" value={counts.agents} tone="green" />
        <StatCard label="Investors" value={counts.investors} tone="violet" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, phone, email, code…"
          />
          <FilterSelect value={persona} onChange={setPersona} options={PERSONA_OPTIONS} />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No users match your filters."
        />
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected ? selected.name : ''}
        footer={
          selected && (
            <>
              {mode === 'view' && selected.persona === 'member' && (
                <>
                  <Button variant="secondary" onClick={() => setMode('investor')}>
                    Make investor
                  </Button>
                  <Button variant="primary" onClick={() => setMode('agent')}>
                    Make agent
                  </Button>
                </>
              )}
              {mode === 'view' && selected.persona !== 'member' && (
                <Button
                  variant="danger"
                  disabled={saving}
                  onClick={() => doRevoke(selected)}
                >
                  Revoke {titleCase(selected.persona)} — back to member
                </Button>
              )}
              {mode === 'agent' && (
                <>
                  <Button variant="secondary" onClick={() => setMode('view')}>
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    disabled={saving}
                    onClick={() => doConvertAgent(selected)}
                  >
                    Convert to agent
                  </Button>
                </>
              )}
              {mode === 'investor' && (
                <>
                  <Button variant="secondary" onClick={() => setMode('view')}>
                    Back
                  </Button>
                  <Button
                    variant="primary"
                    disabled={saving}
                    onClick={() => doConvertInvestor(selected)}
                  >
                    Convert to investor
                  </Button>
                </>
              )}
            </>
          )
        }
      >
        {selected && (
          <>
            <div className="mb-3">
              <Badge tone={PERSONA_TONE[selected.persona]}>
                {titleCase(selected.persona)}
              </Badge>
            </div>

            {mode === 'view' && (
              <DetailList
                rows={[
                  { label: 'Phone', value: selected.phone },
                  { label: 'Email', value: selected.email || '—' },
                  { label: 'Home branch', value: selected.homeStoreName },
                  { label: 'Registered', value: selected.registered ? 'Yes' : 'No' },
                  {
                    label: 'Last login',
                    value: selected.lastLoginAt
                      ? formatDateTime(selected.lastLoginAt)
                      : '—',
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
                ]}
              />
            )}

            {mode === 'agent' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  A new <span className="font-medium text-slate-700">SHD-AGT</span> code
                  is generated. The user keeps the app and gains the agent portal
                  (in-app and in the web console) on next sign-in.
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
                  Parent agent <span className="font-normal text-slate-400">— optional</span>
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
              </div>
            )}

            {mode === 'investor' && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  A new <span className="font-medium text-slate-700">SHD-INV</span> code
                  is generated. The user keeps the app and gains the investor portal
                  on next sign-in.
                </p>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Invested branch <span className="font-normal text-slate-400">— code, optional</span>
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
                      onChange={(e) => setPlanType(e.target.value as InvestorPlanType)}
                      className={`mt-1 ${fieldCls}`}
                    >
                      <option value="yearly">Yearly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </label>
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
      </Modal>
    </>
  );
}
