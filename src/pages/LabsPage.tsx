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
import { formatCurrency, formatDate } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  listLabPackages,
  setLabPackageActive,
  updateLabPackage,
} from '@/api/labPackages';
import type { LabPackage } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All packages' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export default function LabsPage() {
  const { data, loading, error, reload } = useAsync(listLabPackages, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ price: '', mrp: '' });

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !q ||
        row.name.toLowerCase().includes(q) ||
        row.slug.toLowerCase().includes(q);
      const matchesStatus =
        status === 'all' ||
        (status === 'active' ? row.isActive : !row.isActive);
      return matchesQuery && matchesStatus;
    });
  }, [rows, search, status]);

  function open(id: string) {
    const pkg = rows.find((r) => r.id === id);
    if (!pkg) return;
    setSelectedId(id);
    setEditing(false);
    setForm({ price: String(pkg.price), mrp: String(pkg.mrp) });
  }

  async function toggleActive(id: string, isActive: boolean) {
    setSaving(true);
    try {
      await setLabPackageActive(id, isActive);
      setSelectedId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!selected) return;
    const price = Number(form.price);
    const mrp = Number(form.mrp);
    setSaving(true);
    try {
      await updateLabPackage(selected.id, {
        price: Number.isFinite(price) && price >= 0 ? price : selected.price,
        mrp: Number.isFinite(mrp) && mrp >= 0 ? mrp : selected.mrp,
      });
      setEditing(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  const avgReport = rows.length
    ? Math.round(
        rows.reduce((sum, r) => sum + (parseInt(r.reportIn, 10) || 0), 0) /
          rows.length,
      )
    : 0;

  const counts = {
    total: rows.length,
    active: rows.filter((r) => r.isActive).length,
    inactive: rows.filter((r) => !r.isActive).length,
  };

  const columns: Column<LabPackage>[] = [
    {
      key: 'name',
      header: 'Package',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-400">
            <code className="rounded bg-slate-100 px-1 py-0.5">{row.slug}</code>
          </p>
        </div>
      ),
    },
    {
      key: 'tests',
      header: 'Tests',
      render: (row) => `${row.testCount} · ${row.profileCount} profiles`,
    },
    {
      key: 'price',
      header: 'Price',
      render: (row) => (
        <div className="text-right">
          <p className="font-medium text-slate-800">{formatCurrency(row.price)}</p>
          <p className="text-xs text-slate-400">
            <span className="line-through">{formatCurrency(row.mrp)}</span> · save{' '}
            {formatCurrency(row.saved)}
          </p>
        </div>
      ),
      className: 'text-right',
    },
    { key: 'report', header: 'Report in', render: (row) => row.reportIn || '—' },
    { key: 'rating', header: 'Rating', render: (row) => (row.rating ? `★ ${row.rating}` : '—') },
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
        title="Lab Tests"
        subtitle="The diagnostic packages members can book from the app."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Packages" value={counts.total} icon="labs" tone="violet" />
        <StatCard label="Active" value={counts.active} icon="check" tone="green" />
        <StatCard label="Inactive" value={counts.inactive} tone="rose" />
        <StatCard label="Avg report time" value={`~${avgReport} hrs`} tone="blue" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search package name or slug…"
          />
          <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No packages match your filters."
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
                    <Icon name="plus" className="h-4 w-4" /> Edit price
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
                { label: 'Slug', value: selected.slug },
                { label: 'Tests', value: selected.testCount },
                { label: 'Profiles', value: selected.profileCount },
                { label: 'Price', value: formatCurrency(selected.price) },
                { label: 'MRP', value: formatCurrency(selected.mrp) },
                { label: 'Saving', value: formatCurrency(selected.saved) },
                { label: 'Report in', value: selected.reportIn || '—' },
                { label: 'Rating', value: selected.rating ? `★ ${selected.rating}` : '—' },
                { label: 'Booked', value: selected.booked || '—' },
                { label: 'For whom', value: selected.forWhom || '—' },
                { label: 'Sample', value: selected.sample || '—' },
                { label: 'Added', value: formatDate(selected.addedAt) },
              ]}
            />
          </>
        )}

        {selected && editing && (
          <div className="space-y-4">
            <EditField label="Price (₹)">
              <input
                inputMode="numeric"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <EditField label="MRP (₹)">
              <input
                inputMode="numeric"
                value={form.mrp}
                onChange={(e) => setForm({ ...form, mrp: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <p className="text-xs text-slate-400">
              Saving is recalculated as MRP − price on save.
            </p>
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
