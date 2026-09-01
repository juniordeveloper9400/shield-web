import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listStores, setStoreActive, updateStore } from '@/api/stores';
import type { Store } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All branches' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

interface EditForm {
  name: string;
  phone: string;
  hours: string;
  pincode: string;
}

export default function StoresPage() {
  const { data, loading, error, reload } = useAsync(listStores, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EditForm>({
    name: '',
    phone: '',
    hours: '',
    pincode: '',
  });

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !q ||
        row.name.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q) ||
        row.area.toLowerCase().includes(q) ||
        row.city.toLowerCase().includes(q) ||
        row.pincode.includes(q);
      const matchesStatus =
        status === 'all' ||
        (status === 'active' ? row.isActive : !row.isActive);
      return matchesQuery && matchesStatus;
    });
  }, [rows, search, status]);

  function open(id: string) {
    const store = rows.find((r) => r.id === id);
    if (!store) return;
    setSelectedId(id);
    setEditing(false);
    setForm({
      name: store.name,
      phone: store.phone,
      hours: store.hours,
      pincode: store.pincode,
    });
  }

  async function toggleActive(id: string, isActive: boolean) {
    setSaving(true);
    try {
      await setStoreActive(id, isActive);
      setSelectedId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!selected) return;
    setSaving(true);
    try {
      await updateStore(selected.id, {
        name: form.name.trim() || selected.name,
        phone: form.phone.trim(),
        hours: form.hours.trim() || selected.hours,
        pincode: form.pincode.trim() || selected.pincode,
      });
      setEditing(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  const counts = {
    total: rows.length,
    active: rows.filter((r) => r.isActive).length,
    inactive: rows.filter((r) => !r.isActive).length,
    members: rows.reduce((sum, r) => sum + r.memberCount, 0),
  };

  const columns: Column<Store>[] = [
    {
      key: 'name',
      header: 'Branch',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-400">
            <code className="rounded bg-slate-100 px-1 py-0.5">{row.code}</code>
          </p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (row) => (
        <div className="text-sm text-slate-600">
          <p>
            {row.area}, {row.city}
          </p>
          <p className="text-xs text-slate-400">{row.pincode}</p>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (row) => row.phone || '—' },
    {
      key: 'members',
      header: 'Members',
      render: (row) => row.memberCount.toLocaleString('en-IN'),
      className: 'text-right',
    },
    {
      key: 'orders',
      header: 'Orders',
      render: (row) => row.orderCount.toLocaleString('en-IN'),
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.isActive ? 'green' : 'gray'}>
          {row.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => open(row.id)}>
          Manage
        </Button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Stores"
        subtitle="SHIELD branches, their coverage and their details."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Branches" value={counts.total} icon="stores" tone="blue" />
        <StatCard label="Active" value={counts.active} icon="check" tone="green" />
        <StatCard label="Inactive" value={counts.inactive} tone="rose" />
        <StatCard
          label="Members served"
          value={counts.members.toLocaleString('en-IN')}
          icon="admins"
          tone="violet"
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, code, area, pincode…"
          />
          <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No branches match your filters."
        />
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? ''}
        footer={
          selected && (
            <>
              {editing ? (
                <>
                  <Button variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" disabled={saving} onClick={saveEdit}>
                    Save changes
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Icon name="plus" className="h-4 w-4" /> Edit details
                  </Button>
                  {selected.isActive ? (
                    <Button
                      variant="danger"
                      disabled={saving}
                      onClick={() => toggleActive(selected.id, false)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="success"
                      disabled={saving}
                      onClick={() => toggleActive(selected.id, true)}
                    >
                      <Icon name="check" className="h-4 w-4" /> Activate
                    </Button>
                  )}
                </>
              )}
            </>
          )
        }
      >
        {selected && !editing && (
          <>
            <div className="mb-3">
              <Badge tone={selected.isActive ? 'green' : 'gray'}>
                {selected.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <DetailList
              rows={[
                { label: 'Code', value: selected.code },
                {
                  label: 'Address',
                  value: `${selected.area}, ${selected.city}, ${selected.state} - ${selected.pincode}`,
                },
                { label: 'Phone', value: selected.phone || '—' },
                { label: 'Hours', value: selected.hours },
                {
                  label: 'Members',
                  value: selected.memberCount.toLocaleString('en-IN'),
                },
                {
                  label: 'Orders billed',
                  value: selected.orderCount.toLocaleString('en-IN'),
                },
                { label: 'Opened', value: formatDate(selected.openedAt) },
              ]}
            />
          </>
        )}

        {selected && editing && (
          <div className="space-y-4">
            <EditField label="Branch name">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <EditField label="Phone">
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <EditField label="Hours">
              <input
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <EditField label="Pincode">
              <input
                value={form.pincode}
                onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                className={inputClass}
              />
            </EditField>
          </div>
        )}
      </Modal>
    </>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
