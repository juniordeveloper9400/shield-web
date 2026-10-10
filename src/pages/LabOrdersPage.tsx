import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatCurrency, formatDateTime, toneForStatus } from '@/lib/format';
import { LabBookingModal } from '@/components/labs/LabBookingModal';
import { useAsync } from '@/lib/useAsync';
import { listLabBookings } from '@/api/labBookings';
import type { LabBooking, LabBookingStatus } from '@/types';

/** Where a booking actually stands, at a glance — the raw `status` column
 *  plus one milestone the column doesn't carry: whether it's been converted
 *  to a bill (`billAmount > 0`, the same check `LabBillsPage` itself uses).
 *  Mirrors `orderLifecycleStatus` in `lib/orderLifecycle.ts`: cancelled and
 *  report-ready (the lab equivalent of "delivered" — the booking's whole job
 *  is done) both still win outright, but a bill sent in between reads as
 *  "Billed" rather than whatever raw status it happened to be sitting on. */
type LabOrderDisplayStatus = LabBookingStatus | 'billed';

function labOrderDisplayStatus(row: LabBooking): LabOrderDisplayStatus {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'report_ready') return 'report_ready';
  if (row.billAmount > 0) return 'billed';
  return row.status;
}

const STATUS_LABEL: Record<LabOrderDisplayStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  sample_collected: 'Sample collected',
  billed: 'Billed',
  report_ready: 'Report ready',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<LabOrderDisplayStatus, Tone> = {
  requested: 'amber',
  confirmed: 'blue',
  sample_collected: 'violet',
  billed: 'violet',
  report_ready: 'green',
  cancelled: 'red',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'requested', label: 'Requested' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'sample_collected', label: 'Sample collected' },
  { value: 'billed', label: 'Billed' },
  { value: 'report_ready', label: 'Report ready' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function LabOrdersPage() {
  const navigate = useNavigate();
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
      const matchesStatus = status === 'all' || labOrderDisplayStatus(row) === status;
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
    billed: scoped.filter((r) => labOrderDisplayStatus(r) === 'billed').length,
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
      render: (row) => {
        const displayStatus = labOrderDisplayStatus(row);
        const badge = <Badge tone={STATUS_TONE[displayStatus]}>{STATUS_LABEL[displayStatus]}</Badge>;
        // Only once it's actually billed is there anywhere to jump to — the
        // same `?open=` hand-off "Convert to bill →" already uses.
        if (displayStatus !== 'billed' || redacted) return badge;
        return (
          <button
            type="button"
            title="Open this booking's bill"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/lab-bills?open=${row.id}`);
            }}
            className="cursor-pointer"
          >
            {badge}
          </button>
        );
      },
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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Requested" value={counts.requested} icon="alert" tone="amber" />
        <StatCard label="Confirmed" value={counts.confirmed} icon="labs" tone="blue" />
        <StatCard label="Sample collected" value={counts.collected} tone="violet" />
        <StatCard label="Billed" value={counts.billed} icon="receipt" tone="violet" />
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
