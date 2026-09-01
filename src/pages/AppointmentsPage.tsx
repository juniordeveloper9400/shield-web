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
import { Icon } from '@/components/ui/Icon';
import { formatDateTime, titleCase, toneForStatus } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listAppointments, setAppointmentStatus } from '@/api/appointments';
import type { Appointment, AppointmentStatus } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'requested', label: 'Requested' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'tele', label: 'Tele-consult' },
  { value: 'dental', label: 'Dental' },
  { value: 'dietitian', label: 'Dietitian' },
];

export default function AppointmentsPage() {
  const { data, loading, error, reload } = useAsync(listAppointments, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !q ||
        row.memberName.toLowerCase().includes(q) ||
        row.providerName.toLowerCase().includes(q) ||
        row.storeName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q);
      const matchesStatus = status === 'all' || row.status === status;
      const matchesType = type === 'all' || row.type === type;
      return matchesQuery && matchesStatus && matchesType;
    });
  }, [rows, search, status, type]);

  async function changeStatus(id: string, next: AppointmentStatus) {
    setSaving(true);
    try {
      await setAppointmentStatus(id, next);
      setSelectedId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  const counts = {
    requested: rows.filter((r) => r.status === 'requested').length,
    confirmed: rows.filter((r) => r.status === 'confirmed').length,
    completed: rows.filter((r) => r.status === 'completed').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
  };

  const columns: Column<Appointment>[] = [
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
      key: 'type',
      header: 'Type',
      render: (row) => <Badge tone="gray">{titleCase(row.type)}</Badge>,
    },
    { key: 'provider', header: 'Provider', render: (row) => row.providerName },
    { key: 'store', header: 'Branch', render: (row) => row.storeName },
    {
      key: 'scheduled',
      header: 'Scheduled for',
      render: (row) => formatDateTime(row.scheduledFor),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
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
        title="Appointments"
        subtitle="Confirm, complete or cancel clinic, tele and dietitian bookings."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Requested" value={counts.requested} icon="alert" tone="amber" />
        <StatCard label="Confirmed" value={counts.confirmed} icon="appointments" tone="blue" />
        <StatCard label="Completed" value={counts.completed} icon="check" tone="green" />
        <StatCard label="Cancelled" value={counts.cancelled} tone="rose" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search member, provider, branch, phone…"
          />
          <div className="flex flex-wrap gap-2">
            <FilterSelect value={type} onChange={setType} options={TYPE_OPTIONS} />
            <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No appointments match your filters."
        />
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected ? selected.memberName : ''}
        footer={
          selected && (
            <>
              {selected.status === 'requested' && (
                <Button
                  variant="success"
                  disabled={saving}
                  onClick={() => changeStatus(selected.id, 'confirmed')}
                >
                  <Icon name="check" className="h-4 w-4" /> Confirm
                </Button>
              )}
              {(selected.status === 'requested' || selected.status === 'confirmed') && (
                <Button
                  variant="primary"
                  disabled={saving}
                  onClick={() => changeStatus(selected.id, 'completed')}
                >
                  Mark completed
                </Button>
              )}
              {selected.status !== 'cancelled' && selected.status !== 'completed' && (
                <Button
                  variant="danger"
                  disabled={saving}
                  onClick={() => changeStatus(selected.id, 'cancelled')}
                >
                  Cancel
                </Button>
              )}
            </>
          )
        }
      >
        {selected && (
          <>
            <div className="mb-3">
              <Badge tone={toneForStatus(selected.status)}>
                {titleCase(selected.status)}
              </Badge>
            </div>
            <DetailList
              rows={[
                { label: 'Phone', value: selected.memberPhone },
                { label: 'Type', value: titleCase(selected.type) },
                { label: 'Provider', value: selected.providerName },
                { label: 'Branch', value: selected.storeName },
                { label: 'Scheduled for', value: formatDateTime(selected.scheduledFor) },
                { label: 'Requested on', value: formatDateTime(selected.createdAt) },
                { label: 'Notes', value: selected.notes || '—' },
              ]}
            />
          </>
        )}
      </Modal>
    </>
  );
}
