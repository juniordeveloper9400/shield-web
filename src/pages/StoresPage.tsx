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
import {
  listStores,
  setStoreActive,
  updateStore,
  createStore,
} from '@/api/stores';
import type { NewStore, Store } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All branches' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

interface EditForm {
  name: string;
  phone: string;
  hours: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  latitude: string;
  longitude: string;
}

const EMPTY_NEW: NewStore = {
  code: '',
  name: '',
  area: '',
  city: '',
  state: 'Kerala',
  pincode: '',
  phone: '',
  hours: '8:00 AM – 10:00 PM',
  latitude: null,
  longitude: null,
  isActive: true,
};

/** "Melattur" → "SHD-MEL" as a starting code suggestion. */
function suggestCode(area: string): string {
  const letters = area.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return letters ? `SHD-${letters.slice(0, 3)}` : '';
}

/** A coordinate string ("10.03", "", "  ") → a number, or null. */
function coord(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function StoresPage() {
  const { data, loading, error, reload } = useAsync(listStores, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({
    name: '',
    phone: '',
    hours: '',
    area: '',
    city: '',
    state: '',
    pincode: '',
    latitude: '',
    longitude: '',
  });

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewStore>(EMPTY_NEW);
  const [addError, setAddError] = useState<string | null>(null);
  /** True once the admin has typed a code by hand — stop auto-suggesting it. */
  const [codeTouched, setCodeTouched] = useState(false);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function openAdd() {
    setDraft(EMPTY_NEW);
    setAddError(null);
    setCodeTouched(false);
    setAdding(true);
  }

  function patchDraft(patch: Partial<NewStore>) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      // Keep the code tracking the area until the admin edits it directly.
      if (!codeTouched && patch.area !== undefined) {
        next.code = suggestCode(next.area);
      }
      return next;
    });
  }

  async function saveNew() {
    if (!draft.code.trim()) return setAddError('Give the branch a code.');
    if (!draft.name.trim()) return setAddError('Give the branch a name.');
    if (!draft.area.trim() || !draft.city.trim())
      return setAddError('Area and city are required.');
    if (!/^\d{6}$/.test(draft.pincode.trim()))
      return setAddError('Pincode must be 6 digits.');
    setSaving(true);
    setAddError(null);
    try {
      const id = await createStore(draft);
      if (!id) {
        setAddError(
          `The code ${draft.code.trim().toUpperCase()} is already in use.`,
        );
        return;
      }
      setAdding(false);
      reload();
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : 'Could not add the branch.',
      );
    } finally {
      setSaving(false);
    }
  }

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
    setEditError(null);
    setForm({
      name: store.name,
      phone: store.phone,
      hours: store.hours,
      area: store.area,
      city: store.city,
      state: store.state,
      pincode: store.pincode,
      latitude: store.latitude == null ? '' : String(store.latitude),
      longitude: store.longitude == null ? '' : String(store.longitude),
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
    if (form.pincode.trim() && !/^\d{6}$/.test(form.pincode.trim())) {
      setEditError('Pincode must be 6 digits.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      await updateStore(selected.id, {
        name: form.name.trim() || selected.name,
        phone: form.phone.trim(),
        hours: form.hours.trim() || selected.hours,
        area: form.area.trim() || selected.area,
        city: form.city.trim() || selected.city,
        state: form.state.trim() || selected.state,
        pincode: form.pincode.trim() || selected.pincode,
        latitude: coord(form.latitude),
        longitude: coord(form.longitude),
      });
      setEditing(false);
      reload();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : 'Could not save the branch.',
      );
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
        actions={
          <Button variant="primary" onClick={openAdd}>
            <Icon name="plus" className="h-4 w-4" /> Add branch
          </Button>
        }
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
                  label: 'Coordinates',
                  value:
                    selected.latitude != null && selected.longitude != null
                      ? `${selected.latitude}, ${selected.longitude}`
                      : '— (app ranks this branch by pincode)',
                },
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
            <div className="grid grid-cols-2 gap-3">
              <EditField label="Area">
                <input
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                  className={inputClass}
                />
              </EditField>
              <EditField label="City">
                <input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className={inputClass}
                />
              </EditField>
              <EditField label="State">
                <input
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className={inputClass}
                />
              </EditField>
              <EditField label="Pincode">
                <input
                  value={form.pincode}
                  onChange={(e) => setForm({ ...form, pincode: e.target.value })}
                  className={inputClass}
                  inputMode="numeric"
                  maxLength={6}
                />
              </EditField>
              <EditField label="Latitude — optional">
                <input
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                  className={inputClass}
                  inputMode="decimal"
                  placeholder="10.9974"
                />
              </EditField>
              <EditField label="Longitude — optional">
                <input
                  value={form.longitude}
                  onChange={(e) =>
                    setForm({ ...form, longitude: e.target.value })
                  }
                  className={inputClass}
                  inputMode="decimal"
                  placeholder="76.1889"
                />
              </EditField>
            </div>
            {editError && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {editError}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add branch"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={saveNew}>
              Create branch
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <EditField label="Branch name">
            <input
              value={draft.name}
              onChange={(e) => patchDraft({ name: e.target.value })}
              className={inputClass}
              placeholder="SHIELD Pharmacy Melattur"
            />
          </EditField>
          <div className="grid grid-cols-2 gap-3">
            <EditField label="Code">
              <input
                value={draft.code}
                onChange={(e) => {
                  setCodeTouched(true);
                  patchDraft({ code: e.target.value.toUpperCase() });
                }}
                className={inputClass}
                placeholder="SHD-MEL"
              />
            </EditField>
            <EditField label="Phone">
              <input
                value={draft.phone}
                onChange={(e) => patchDraft({ phone: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <EditField label="Area">
              <input
                value={draft.area}
                onChange={(e) => patchDraft({ area: e.target.value })}
                className={inputClass}
                placeholder="Melattur"
              />
            </EditField>
            <EditField label="City">
              <input
                value={draft.city}
                onChange={(e) => patchDraft({ city: e.target.value })}
                className={inputClass}
                placeholder="Malappuram"
              />
            </EditField>
            <EditField label="State">
              <input
                value={draft.state}
                onChange={(e) => patchDraft({ state: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <EditField label="Pincode">
              <input
                value={draft.pincode}
                onChange={(e) => patchDraft({ pincode: e.target.value })}
                className={inputClass}
                inputMode="numeric"
                maxLength={6}
                placeholder="679326"
              />
            </EditField>
          </div>
          <EditField label="Hours">
            <input
              value={draft.hours}
              onChange={(e) => patchDraft({ hours: e.target.value })}
              className={inputClass}
            />
          </EditField>
          <div className="grid grid-cols-2 gap-3">
            <EditField label="Latitude — optional">
              <input
                value={draft.latitude ?? ''}
                onChange={(e) =>
                  patchDraft({ latitude: coord(e.target.value) })
                }
                className={inputClass}
                inputMode="decimal"
                placeholder="10.9974"
              />
            </EditField>
            <EditField label="Longitude — optional">
              <input
                value={draft.longitude ?? ''}
                onChange={(e) =>
                  patchDraft({ longitude: coord(e.target.value) })
                }
                className={inputClass}
                inputMode="decimal"
                placeholder="76.1889"
              />
            </EditField>
          </div>
          <p className="text-xs text-slate-400">
            Coordinates let the customer app rank this branch by distance;
            leave them blank and it falls back to pincode matching.
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => patchDraft({ isActive: e.target.checked })}
            />
            Active — visible in the app straight away
          </label>
          {addError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {addError}
            </p>
          )}
        </div>
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
