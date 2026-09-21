import { useMemo, useState } from 'react';
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
  const { data, loading, error, reload } = useAsync(listLabBookings, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.packageName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q);
      const matchesStatus = status === 'all' || row.status === status;
      return matchesQuery && matchesStatus;
    });
  }, [rows, search, status]);

  const counts = {
    requested: rows.filter((r) => r.status === 'requested').length,
    confirmed: rows.filter((r) => r.status === 'confirmed').length,
    collected: rows.filter((r) => r.status === 'sample_collected').length,
    ready: rows.filter((r) => r.status === 'report_ready').length,
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
          Manage
        </Button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Lab Orders"
        subtitle="Member lab-test bookings and where each one is in the process."
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
            placeholder="Search booking, member, package…"
          />
          <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No bookings match your filters."
        />
      </Card>

      <LabBookingModal
        booking={selected}
        onClose={() => setSelectedId(null)}
        onChanged={reload}
      />
    </>
  );
}
