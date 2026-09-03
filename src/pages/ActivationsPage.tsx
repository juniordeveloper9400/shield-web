import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canReviewActivations, scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatCurrency, titleCase, toneForStatus } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listActivations } from '@/api/activations';
import type { PrivilegeActivation, PrivilegeActivationStatus } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** All the plans one member has activated, rolled into a single list row. */
interface MemberGroup {
  id: string; // memberId
  memberName: string;
  memberPhone: string;
  storeCode: string;
  storeName: string;
  plans: PrivilegeActivation[];
  tiers: string[];
  totalLoad: number;
  totalCredited: number;
  pending: number;
  latestStatus: PrivilegeActivationStatus;
}

function groupByMember(rows: PrivilegeActivation[]): MemberGroup[] {
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
        totalLoad: 0,
        totalCredited: 0,
        pending: 0,
        latestStatus: r.status,
      };
      map.set(key, g);
    }
    g.plans.push(r);
    if (!g.tiers.includes(r.tier)) g.tiers.push(r.tier);
    g.totalLoad += r.amount;
    if (r.status === 'approved') g.totalCredited += r.credited;
    if (r.status === 'pending') g.pending += 1;
  }
  // `rows` is already pending-first then newest, so the first plan seen is the
  // one to show as the member's headline status.
  for (const g of map.values()) g.latestStatus = g.plans[0].status;
  return [...map.values()];
}

export default function ActivationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(listActivations, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [store, setStore] = useState('all');

  const scoped = useMemo(() => scopeToStore(rows, user), [rows, user]);
  const branchBound = user?.role === 'pharmacy' && Boolean(user.storeCode);
  const canReview = user ? canReviewActivations(user.role) : false;

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of scoped) if (a.storeCode) seen.set(a.storeCode, a.storeName);
    return [
      { value: 'all', label: 'All branches' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [scoped]);

  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.memberName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q) ||
        row.tier.toLowerCase().includes(q) ||
        row.cardNumber.toLowerCase().includes(q);
      const matchesStatus = status === 'all' || row.status === status;
      const matchesStore = store === 'all' || row.storeCode === store;
      return matchesQuery && matchesStatus && matchesStore;
    });
  }, [scoped, search, status, store]);

  const members = useMemo(() => groupByMember(filteredPlans), [filteredPlans]);

  const counts = {
    pending: scoped.filter((r) => r.status === 'pending').length,
    approved: scoped.filter((r) => r.status === 'approved').length,
    rejected: scoped.filter((r) => r.status === 'rejected').length,
  };
  const pendingValue = scoped
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + r.amount, 0);

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
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          {row.tiers.map((t) => (
            <Badge key={t} tone="gray">
              {t}
            </Badge>
          ))}
          {row.plans.length > row.tiers.length && (
            <span className="text-xs text-slate-400">
              · {row.plans.length} total
            </span>
          )}
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
      key: 'load',
      header: 'Total load',
      render: (row) => formatCurrency(row.totalLoad),
      className: 'text-right',
    },
    {
      key: 'credited',
      header: 'Credited',
      render: (row) => formatCurrency(row.totalCredited),
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.pending > 0 ? (
          <Badge tone="amber">{row.pending} pending</Badge>
        ) : (
          <Badge tone={toneForStatus(row.latestStatus)}>
            {titleCase(row.latestStatus)}
          </Badge>
        ),
    },
    {
      key: 'go',
      header: '',
      render: (row) => (
        <span className="text-xs font-medium text-brand-600">
          {row.pending > 0 && canReview ? 'Review' : 'More'} →
        </span>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Privilege plans"
        subtitle={
          branchBound
            ? 'Members who activated a plan at your branch — open one to see their cards.'
            : 'Members who activated a privilege plan — open one to see their cards.'
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending" value={counts.pending} icon="alert" tone="amber" />
        <StatCard
          label="Pending value"
          value={formatCurrency(pendingValue)}
          tone="blue"
        />
        <StatCard label="Approved" value={counts.approved} icon="check" tone="green" />
        <StatCard label="Rejected" value={counts.rejected} tone="rose" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search member, phone, plan, card…"
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
          rows={members}
          loading={loading}
          error={error}
          empty="No activations match your filters."
          onRowClick={(row) => navigate(`/activations/member/${row.id}`)}
        />
      </Card>
    </>
  );
}
