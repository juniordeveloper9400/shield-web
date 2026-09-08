import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { PrescriptionReviewModal } from '@/components/prescriptions/PrescriptionReviewModal';
import { toneForStatus } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listPrescriptions } from '@/api/prescriptions';
import type { Prescription, PrescriptionStatus } from '@/types';

const STATUS_LABEL: Record<PrescriptionStatus, string> = {
  awaiting_review: 'Awaiting review',
  read: 'Read',
  in_cart: 'In cart',
  ordered: 'Ordered',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'awaiting_review', label: 'Awaiting review' },
  { value: 'read', label: 'Read' },
  { value: 'in_cart', label: 'In cart' },
  { value: 'ordered', label: 'Ordered' },
];

export default function PrescriptionsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listPrescriptions, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [store, setStore] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const scoped = useMemo(() => scopeToStore(rows, user), [rows, user]);
  const branchBound = user?.role === 'pharmacy' && Boolean(user.storeCode);

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of scoped) if (p.storeCode) seen.set(p.storeCode, p.storeName);
    return [
      { value: 'all', label: 'All branches' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [scoped]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.patientName.toLowerCase().includes(q) ||
        row.doctor.toLowerCase().includes(q);
      const matchesStatus = status === 'all' || row.status === status;
      const matchesStore = store === 'all' || row.storeCode === store;
      return matchesQuery && matchesStatus && matchesStore;
    });
  }, [scoped, search, status, store]);

  const counts = {
    awaiting: scoped.filter((r) => r.status === 'awaiting_review').length,
    read: scoped.filter((r) => r.status === 'read').length,
    inCart: scoped.filter((r) => r.status === 'in_cart').length,
    ordered: scoped.filter((r) => r.status === 'ordered').length,
  };

  const columns: Column<Prescription>[] = [
    {
      key: 'code',
      header: 'Prescription',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.code}</p>
          <p className="text-xs text-slate-400">{row.fileName}</p>
        </div>
      ),
    },
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
    { key: 'patient', header: 'Patient', render: (row) => row.patientName },
    { key: 'doctor', header: 'Doctor', render: (row) => row.doctor || '—' },
    ...(branchBound
      ? []
      : [
          {
            key: 'branch',
            header: 'Branch',
            render: (row: Prescription) => row.storeName,
          } as Column<Prescription>,
        ]),
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={toneForStatus(row.status)}>{STATUS_LABEL[row.status]}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => setSelectedId(row.id)}>
          Open
        </Button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Prescriptions"
        subtitle={
          branchBound
            ? 'Scripts members uploaded for your branch.'
            : 'Scripts members uploaded, across every branch.'
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Awaiting review" value={counts.awaiting} icon="alert" tone="amber" />
        <StatCard label="Read" value={counts.read} icon="prescriptions" tone="blue" />
        <StatCard label="In cart" value={counts.inCart} icon="orders" tone="violet" />
        <StatCard label="Ordered" value={counts.ordered} icon="check" tone="green" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search code, member, patient, doctor…"
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
          empty="No prescriptions match your filters."
        />
      </Card>

      <PrescriptionReviewModal
        prescription={selected}
        onClose={() => setSelectedId(null)}
        onSaved={reload}
      />
    </>
  );
}
