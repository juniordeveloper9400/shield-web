import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import { initials } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { api, ApiError } from '@/lib/api';
import { listStores } from '@/api/stores';
import {
  MODULES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_SUMMARY,
  canAccess,
} from '@/config/permissions';
import type { Role } from '@/types';

const ROLES = Object.keys(ROLE_LABELS) as Role[];

const ROLE_COLOR: Record<Role, string> = {
  superadmin: '#2c57a6',
  admin: '#0f766e',
  pharmacy: '#1f7a4d',
  lab: '#8a5b1f',
  appointments: '#6b3fa0',
  delivery: '#c2410c',
};

/** Roles whose account is tied to one branch — the "add staff" form only
 *  requires/shows a store picker for these. */
const STORE_BOUND_ROLES: Role[] = ['pharmacy', 'delivery'];

const EMPTY_FORM = {
  loginId: '',
  name: '',
  password: '',
  role: 'pharmacy' as Role,
  storeId: '',
};

interface AdminRow {
  id: string;
  loginId: string;
  name: string;
  role: Role;
  storeCode?: string;
}

interface StaffApiRow {
  id: number;
  loginId: string;
  name: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'PHARMACY' | 'LAB' | 'APPOINTMENTS';
  storeId: number | null;
  storeCode: string | null;
  isActive: boolean;
}

function toAdminRow(r: StaffApiRow): AdminRow {
  const role = r.role.toLowerCase() as Role;
  return {
    id: String(r.id),
    loginId: r.loginId,
    name: r.name,
    role,
    storeCode: role === 'pharmacy' && r.storeCode ? r.storeCode : undefined,
  };
}

/**
 * Real staff accounts from backend/api (`GET /v1/staff/admins`) — replaces
 * the preset roster that used to live in `config/admins.ts`. Adding a login
 * is now a real account (a login id + bcrypt-hashed password on this row),
 * created here via `POST /v1/staff/admins` (SUPERADMIN-only, same as this
 * whole page). Editing/deactivating an existing account is still a
 * follow-up.
 */
export default function AdminsPage() {
  const { accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(
    () => api.get<StaffApiRow[]>('/v1/staff/admins', accessToken),
    [accessToken],
  );
  const rows = useMemo<AdminRow[]>(() => (data ?? []).map(toAdminRow), [data]);

  const { data: storeRows } = useAsync(listStores, []);
  const storeOptions = useMemo(
    () => (storeRows ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [storeRows],
  );

  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openModal() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  const storeBound = STORE_BOUND_ROLES.includes(form.role);

  async function submit() {
    setFormError(null);
    if (!form.loginId.trim() || !form.name.trim() || !form.password) {
      setFormError('Login id, name and password are all required.');
      return;
    }
    if (storeBound && !form.storeId) {
      setFormError('Pick the branch this account works.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(
        '/v1/staff/admins',
        {
          loginId: form.loginId.trim(),
          name: form.name.trim(),
          password: form.password,
          role: form.role.toUpperCase(),
          ...(storeBound && form.storeId ? { storeId: Number(form.storeId) } : {}),
        },
        accessToken,
      );
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Could not create the account.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        !q ||
        row.name.toLowerCase().includes(q) ||
        row.loginId.toLowerCase().includes(q) ||
        (row.storeCode ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const byRole = (role: Role) => rows.filter((r) => r.role === role).length;

  const columns: Column<AdminRow>[] = [
    {
      key: 'name',
      header: 'Admin',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: ROLE_COLOR[row.role] }}
          >
            {initials(row.name)}
          </span>
          <div>
            <p className="font-medium text-slate-800">{row.name}</p>
            <p className="text-xs text-slate-400">
              <code className="rounded bg-slate-100 px-1 py-0.5">{row.loginId}</code>
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Badge tone="blue">{ROLE_LABELS[row.role]}</Badge>
          {row.storeCode && (
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-600">
              {row.storeCode}
            </code>
          )}
        </div>
      ),
    },
    {
      key: 'modules',
      header: 'Can open',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {ROLE_PERMISSIONS[row.role].map((key) => (
            <span
              key={key}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] capitalize text-slate-600"
            >
              {key}
            </span>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Admins"
        subtitle="Staff accounts for the console — SUPERADMIN only."
        actions={
          <Button size="sm" onClick={openModal}>
            <Icon name="plus" className="h-4 w-4" />
            Add staff account
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-5">
        <StatCard label="Total logins" value={rows.length} icon="admins" tone="blue" />
        <StatCard
          label="Super Admin / Admin"
          value={byRole('superadmin') + byRole('admin')}
          icon="check"
          tone="green"
        />
        <StatCard label="Pharmacy" value={byRole('pharmacy')} tone="violet" />
        <StatCard label="Lab / Appts" value={byRole('lab') + byRole('appointments')} tone="amber" />
        <StatCard label="Delivery" value={byRole('delivery')} icon="deliveries" tone="rose" />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Role → module access"
          subtitle="A login inherits the access of its role"
        />
        <div className="overflow-x-auto p-4">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Role</th>
                {MODULES.map((m) => (
                  <th key={m.key} className="px-3 py-2 text-center capitalize">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ROLES.map((role) => (
                <tr key={role}>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{ROLE_LABELS[role]}</p>
                    <p className="text-xs text-slate-400">{ROLE_SUMMARY[role]}</p>
                  </td>
                  {MODULES.map((m) => (
                    <td key={m.key} className="px-3 py-2 text-center">
                      {canAccess(role, m.key) ? (
                        <Icon
                          name="check"
                          className="mx-auto h-4 w-4 text-emerald-500"
                        />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="border-b border-slate-200 p-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, login ID or branch…"
          />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No staff accounts match your search."
        />
        <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-400">
          Each account signs in with a login ID and password. Editing or
          deactivating an existing account from this page is a follow-up —
          for now, ask a Super Admin with backend access.
        </p>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add staff account"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create account'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Login id
            </label>
            <input
              value={form.loginId}
              onChange={(e) => setForm((f) => ({ ...f, loginId: e.target.value }))}
              placeholder="e.g. pharmacy_mel"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Password
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="At least 8 characters"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Role</label>
            <select
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({ ...f, role: e.target.value as Role, storeId: '' }))
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          {storeBound && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Branch
              </label>
              <select
                value={form.storeId}
                onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">Select a branch…</option>
                {storeOptions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {formError && <p className="text-xs text-rose-600">{formError}</p>}
        </div>
      </Modal>
    </>
  );
}
