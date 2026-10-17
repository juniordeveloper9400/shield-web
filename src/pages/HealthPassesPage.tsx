import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge, type Tone } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatCurrency } from '@/lib/format';
import { planStateOf, type PlanState } from '@/lib/healthPass';
import { useAsync } from '@/lib/useAsync';
import { listActivations } from '@/api/activations';
import type { PrivilegeActivation } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All members' },
  { value: 'active', label: 'Active' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'expired', label: 'Expired' },
  { value: 'pending', label: 'Pending submission' },
];

/** The overall badge a member's whole roster of plans reduces to — the most
 *  "needs a look" state wins: a pending submission first, then the
 *  computed Active/Waiting/Expired state of whatever's actually approved. */
type OverallState = PlanState | 'pending';

const STATE_LABEL: Record<OverallState, string> = {
  active: 'Active',
  waiting: 'Waiting',
  expired: 'Expired',
  pending: 'Pending',
};
const STATE_TONE: Record<OverallState, Tone> = {
  active: 'green',
  waiting: 'amber',
  expired: 'gray',
  pending: 'blue',
};

interface MemberGroup {
  id: string; // memberId
  memberName: string;
  memberPhone: string;
  storeCode: string;
  storeName: string;
  plans: PrivilegeActivation[];
  tiers: string[];
  totalLoaded: number;
  pendingCount: number;
  overallState: OverallState;
}

function groupByMember(rows: PrivilegeActivation[], asOf: Date): MemberGroup[] {
  const map = new Map<string, MemberGroup>();
  for (const r of rows) {
    const key = r.memberId || r.memberPhone;
    let g = map.get(key);
    if (!g) {
      g = {
        id: key,
        memberName: r.memberName,
        memberPhone: r.memberPhone,
        storeCode: r.storeCode,
        storeName: r.storeName,
        plans: [],
        tiers: [],
        totalLoaded: 0,
        pendingCount: 0,
        overallState: 'expired',
      };
      map.set(key, g);
    }
    g.plans.push(r);
    if (r.status === 'approved') {
      if (!g.tiers.includes(r.tier)) g.tiers.push(r.tier);
      g.totalLoaded += r.credited;
    }
    if (r.status === 'pending' || r.status === 'on_hold') g.pendingCount += 1;
  }
  for (const g of map.values()) {
    const approved = g.plans.filter((p) => p.status === 'approved');
    const states = approved.map((p) => planStateOf({ issuedOn: p.issuedOn, expiresOn: p.expiresOn }, asOf));
    g.overallState = states.includes('active')
      ? 'active'
      : states.includes('waiting')
        ? 'waiting'
        : g.pendingCount > 0
          ? 'pending'
          : 'expired';
  }
  return [...map.values()];
}

/**
 * Every member who has ever activated (or submitted) a Health Pass plan,
 * with their current state and total loaded at a glance — the roster
 * behind `MemberActivationsPage`'s own full detail (balance, monthly
 * allowance + carry-forward, per-plan release progress), which this links
 * into. Separate from "Health Pass plan approvals" (`ActivationsPage`):
 * that page is a working queue of what still needs a decision; this one is
 * a directory of who holds what, decided or not.
 */
export default function HealthPassesPage() {
  const { user, accessToken } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(() => listActivations(accessToken), [accessToken]);
  const rows = useMemo(() => data ?? [], [data]);
  const asOf = useMemo(() => new Date(), []);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [store, setStore] = useState('all');

  const scoped = useMemo(() => scopeToStore(rows, user), [rows, user]);
  const branchBound = user?.role === 'pharmacy' && Boolean(user.storeCode);

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of scoped) if (a.storeCode) seen.set(a.storeCode, a.storeName);
    return [
      { value: 'all', label: 'All branches' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [scoped]);

  const members = useMemo(() => groupByMember(scoped, asOf), [scoped, asOf]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      const matchesQuery =
        !q ||
        m.memberName.toLowerCase().includes(q) ||
        m.memberPhone.includes(q) ||
        m.tiers.some((t) => t.toLowerCase().includes(q));
      const matchesStatus = status === 'all' || m.overallState === status;
      const matchesStore = store === 'all' || m.storeCode === store;
      return matchesQuery && matchesStatus && matchesStore;
    });
  }, [members, search, status, store]);

  const counts = {
    active: members.filter((m) => m.overallState === 'active').length,
    waiting: members.filter((m) => m.overallState === 'waiting').length,
    expired: members.filter((m) => m.overallState === 'expired').length,
    pending: members.filter((m) => m.overallState === 'pending').length,
  };

  const columns: Column<MemberGroup>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.memberName}</p>
          <p className="text-xs text-slate-400">{row.memberPhone}</p>
        </div>
      ),
    },
    {
      key: 'plans',
      header: 'Plans',
      render: (row) =>
        row.tiers.length === 0 ? (
          <span className="text-xs text-slate-400">None activated yet</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {row.tiers.map((t) => (
              <Badge key={t} tone="gray">
                {t}
              </Badge>
            ))}
          </div>
        ),
    },
    ...(branchBound
      ? []
      : [
          {
            key: 'branch',
            header: 'Branch',
            render: (row: MemberGroup) => row.storeName,
          } as Column<MemberGroup>,
        ]),
    {
      key: 'loaded',
      header: 'Total loaded',
      render: (row) => (row.totalLoaded > 0 ? formatCurrency(row.totalLoaded) : '—'),
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Badge tone={STATE_TONE[row.overallState]}>{STATE_LABEL[row.overallState]}</Badge>
          {row.pendingCount > 0 && row.overallState !== 'pending' && (
            <span className="text-xs text-amber-600">+{row.pendingCount} pending</span>
          )}
        </div>
      ),
    },
    {
      key: 'go',
      header: '',
      render: () => <span className="text-xs font-medium text-brand-600">Details →</span>,
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Health Passes"
        subtitle={
          branchBound
            ? "Your branch's members and their Health Pass plans — balance, monthly allowance and expiry."
            : "Every member's Health Pass plans — balance, monthly allowance and expiry."
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active" value={counts.active} icon="check" tone="green" />
        <StatCard label="Waiting" value={counts.waiting} tone="amber" />
        <StatCard label="Expired" value={counts.expired} tone="rose" />
        <StatCard label="Pending submission" value={counts.pending} icon="alert" tone="blue" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search member, phone or plan…"
          />
          <div className="flex flex-wrap gap-2">
            {!branchBound && (
              <FilterSelect value={store} onChange={setStore} options={storeOptions} />
            )}
            <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No members match your filters."
          onRowClick={(row) => navigate(`/activations/member/${row.id}`)}
        />
      </Card>
    </>
  );
}
