import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { PrescriptionReviewModal } from '@/components/prescriptions/PrescriptionReviewModal';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listPrescriptions } from '@/api/prescriptions';
import type { Prescription } from '@/types';
import {
  ORDER_LIFECYCLE_LABEL,
  ORDER_LIFECYCLE_OPTIONS,
  ORDER_LIFECYCLE_TONE,
  prescriptionLifecycleStatus,
} from '@/lib/orderLifecycle';

// The list shows the linked order's lifecycle (Pending → Completed), the same
// rule as OrdersPage — see prescriptionLifecycleStatus for why not `row.status`.
const lifecycleOf = prescriptionLifecycleStatus;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...ORDER_LIFECYCLE_OPTIONS,
  { value: 'cancelled', label: ORDER_LIFECYCLE_LABEL.cancelled },
];

const FULFILLMENT_OPTIONS = [
  { value: 'all', label: 'All delivery types' },
  { value: 'home_delivery', label: 'Home Delivery' },
  { value: 'store_pickup', label: 'Store Pickup' },
];

export default function PrescriptionsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listPrescriptions, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [fulfillment, setFulfillment] = useState('all');
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
      const matchesStatus = status === 'all' || lifecycleOf(row) === status;
      const matchesFulfillment =
        fulfillment === 'all' || row.fulfillmentType === fulfillment;
      const matchesStore = store === 'all' || row.storeCode === store;
      return matchesQuery && matchesStatus && matchesFulfillment && matchesStore;
    });
  }, [scoped, search, status, fulfillment, store]);

  const counts = {
    pending: scoped.filter((r) => lifecycleOf(r) === 'pending').length,
    processed: scoped.filter((r) => lifecycleOf(r) === 'processed').length,
    billing: scoped.filter((r) => lifecycleOf(r) === 'billing').length,
    completed: scoped.filter((r) => lifecycleOf(r) === 'completed').length,
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
    {
      key: 'uploaded',
      header: 'Uploaded',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-slate-500">
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
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
      key: 'fulfillment',
      header: 'Delivery Type',
      render: (row) => (
        <Badge tone={row.fulfillmentType === 'home_delivery' ? 'blue' : 'gray'}>
          {row.fulfillmentType === 'home_delivery' ? 'Home Delivery' : 'Store Pickup'}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={ORDER_LIFECYCLE_TONE[lifecycleOf(row)]}>
          {ORDER_LIFECYCLE_LABEL[lifecycleOf(row)]}
        </Badge>
      ),
    },
    {
      key: 'go',
      header: '',
      render: () => (
        <span className="text-xs font-medium text-brand-600">Open →</span>
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
        <StatCard label="Pending" value={counts.pending} icon="alert" tone="amber" />
        <StatCard label="Processed" value={counts.processed} icon="prescriptions" tone="blue" />
        <StatCard label="Billing" value={counts.billing} icon="orders" tone="violet" />
        <StatCard label="Completed" value={counts.completed} icon="check" tone="green" />
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
            <FilterSelect value={fulfillment} onChange={setFulfillment} options={FULFILLMENT_OPTIONS} />
            <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No prescriptions match your filters."
          onRowClick={(row) => setSelectedId(row.id)}
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
