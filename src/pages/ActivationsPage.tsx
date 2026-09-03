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
import {
  formatCurrency,
  formatDateTime,
  titleCase,
  toneForStatus,
} from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listActivations } from '@/api/activations';
import type { PrivilegeActivation } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

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

  const filtered = useMemo(() => {
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

  const counts = {
    pending: scoped.filter((r) => r.status === 'pending').length,
    approved: scoped.filter((r) => r.status === 'approved').length,
    rejected: scoped.filter((r) => r.status === 'rejected').length,
  };
  const pendingValue = scoped
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + r.amount, 0);

  const columns: Column<PrivilegeActivation>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (row) => (
        <div>
          <p className="text-slate-800">{row.memberName}</p>
          <p className="text-xs text-slate-400">{row.memberPhone}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.tier}</p>
          <p className="text-xs text-slate-400">
            {row.cardNumber || '—'} · {formatDateTime(row.submittedAt)}
          </p>
        </div>
      ),
    },
    ...(branchBound
      ? []
      : [
          {
            key: 'branch',
            header: 'Branch',
            render: (row: PrivilegeActivation) => row.storeName,
          } as Column<PrivilegeActivation>,
        ]),
    {
      key: 'load',
      header: 'Load',
      render: (row) => formatCurrency(row.amount),
      className: 'text-right',
    },
    {
      key: 'credited',
      header: 'Credits',
      render: (row) => formatCurrency(row.credited),
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
      ),
    },
    {
      key: 'go',
      header: '',
      render: (row) => (
        <span className="text-xs font-medium text-brand-600">
          {row.status === 'pending' && canReview ? 'Review' : 'Open'} →
        </span>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Activations"
        subtitle={
          branchBound
            ? 'Privilege plans submitted at your branch, awaiting approval.'
            : 'Privilege plans members submitted, awaiting approval.'
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
          rows={filtered}
          loading={loading}
          error={error}
          empty="No activations match your filters."
          onRowClick={(row) => navigate(`/activations/${row.id}`)}
        />
      </Card>
    </>
  );
}
