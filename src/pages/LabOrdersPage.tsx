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
import { formatCurrency, formatDateTime, toneForStatus } from '@/lib/format';
import { LabBookingModal } from '@/components/labs/LabBookingModal';
import { useAsync } from '@/lib/useAsync';
import { listLabBookings } from '@/api/labBookings';
import type { LabBooking, LabBookingStatus } from '@/types';

const STATUS_LABEL: Record<LabBookingStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  sample_collected: 'Sample collected',
  report_ready: 'Report ready',
  cancelled: 'Cancelled',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'requested', label: 'Requested' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'sample_collected', label: 'Sample collected' },
  { value: 'report_ready', label: 'Report ready' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function LabOrdersPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listLabBookings, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [store, setStore] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A Lab Technician only ever has their own branch's bookings to look at —
  // Pharmacy sees this same scoping, but with the patient/test detail
  // stripped from every column below instead of a whole branch's worth of
  // someone else's bookings.
  const scoped = useMemo(() => scopeToStore(rows, user), [rows, user]);
  const branchBound = (user?.role === 'pharmacy' || user?.role === 'lab_technician') && Boolean(user.storeCode);
  // Pharmacy sees that a lab order exists for their branch — enough to
  // reconcile it as "an order" — but never who it was for or what test was
  // booked, and can't manage the lab workflow itself.
  const redacted = user?.role === 'pharmacy';

  const selected = redacted ? null : (scoped.find((r) => r.id === selectedId) ?? null);

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of scoped) if (r.storeCode) seen.set(r.storeCode, r.storeName);
    return [
      { value: 'all', label: 'All branches' },
      { value: 'none', label: 'No branch on record' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        (!redacted &&
          (row.memberName.toLowerCase().includes(q) ||
            row.packageName.toLowerCase().includes(q) ||
            row.memberPhone.includes(q)));
      const matchesStatus = status === 'all' || row.status === status;
      const matchesStore =
        branchBound ||
        store === 'all' ||
        (store === 'none' ? !row.storeCode : row.storeCode === store);
      return matchesQuery && matchesStatus && matchesStore;
    });
  }, [scoped, search, status, store, branchBound, redacted]);

  const counts = {
    requested: scoped.filter((r) => r.status === 'requested').length,
    confirmed: scoped.filter((r) => r.status === 'confirmed').length,
    collected: scoped.filter((r) => r.status === 'sample_collected').length,
    ready: scoped.filter((r) => r.status === 'report_ready').length,
  };

  const columns: Column<LabBooking>[] = [
    {
      key: 'code',
      header: 'Booking',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.code}</p>
          <p className="text-xs text-slate-400">{formatDateTime(row.createdAt)}</p>
        </div>
      ),
    },
    // Who it was for and what was booked — a store admin sees that the
    // order exists, never this; a Lab Technician (own branch) or Lab Admin
    // (every branch) needs exactly this to actually do the work.
    ...(redacted
      ? []
      : ([
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
          { key: 'package', header: 'Package', render: (row) => row.packageName },
        ] as Column<LabBooking>[])),
    ...(branchBound
      ? []
      : ([
          {
            key: 'branch',
            header: 'Branch',
            render: (row) => row.storeName || <span className="text-slate-400">—</span>,
          },
        ] as Column<LabBooking>[])),
    {
      key: 'patients',
      header: 'Patients',
      render: (row) => row.patientsCount,
      className: 'text-right',
    },
    {
      key: 'total',
      header: 'Total',
      render: (row) => formatCurrency(row.totalPrice),
      className: 'text-right',
    },
    {
      key: 'scheduled',
      header: 'Scheduled',
      render: (row) => formatDateTime(row.scheduledFor),
    },
    ...(redacted
      ? []
      : ([
          {
            key: 'report',
            header: 'Report',
            render: (row) =>
              row.reportPages > 0 ? (
                <span className="text-slate-700">
                  {row.reportPages} page{row.reportPages === 1 ? '' : 's'}
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              ),
          },
        ] as Column<LabBooking>[])),
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={toneForStatus(row.status)}>{STATUS_LABEL[row.status]}</Badge>
      ),
    },
    // A store admin only ever looks — managing the lab workflow (schedule,
    // notes, the report itself) isn't theirs to do from here.
    ...(redacted
      ? []
      : ([
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <Button variant="secondary" size="sm" onClick={() => setSelectedId(row.id)}>
                Manage
              </Button>
            ),
            className: 'text-right',
          },
        ] as Column<LabBooking>[])),
  ];

  return (
    <>
      <PageHeader
        title="Lab Orders"
        subtitle={
          redacted
            ? 'Lab-test bookings placed against your branch — patient and test detail is handled by the lab.'
            : branchBound
              ? 'Lab-test bookings for your branch and where each one is in the process.'
              : 'Member lab-test bookings and where each one is in the process.'
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Requested" value={counts.requested} icon="alert" tone="amber" />
        <StatCard label="Confirmed" value={counts.confirmed} icon="labs" tone="blue" />
        <StatCard label="Sample collected" value={counts.collected} tone="violet" />
        <StatCard label="Report ready" value={counts.ready} icon="check" tone="green" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={redacted ? 'Search booking…' : 'Search booking, member, package…'}
          />
          <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          {!branchBound && (
            <FilterSelect value={store} onChange={setStore} options={storeOptions} />
          )}
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No bookings match your filters."
          {...(redacted ? {} : { onRowClick: (row: LabBooking) => setSelectedId(row.id) })}
        />
      </Card>

      {!redacted && (
        <LabBookingModal
          booking={selected}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}
