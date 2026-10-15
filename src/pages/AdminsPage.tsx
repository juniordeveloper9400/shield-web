import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import { initials } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { useConfirmDialog } from '@/lib/useConfirmDialog';
import { ApiError } from '@/lib/api';
import { listStores } from '@/api/stores';
import { createStaffAccount, listStaffAccounts, updateStaffAccount, type StaffAccount } from '@/api/admins';
import {
  MODULES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_SUMMARY,
  STORE_BOUND_ROLES,
  allowedModules,
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
  lab_technician: '#a1650d',
};

const EMPTY_FORM = {
  loginId: '',
  name: '',
  password: '',
  role: 'pharmacy' as Role,
  storeId: '',
};

/** Granting (or changing) a Super Admin/Admin account is Super-Admin-only —
 *  mirrors AdminService.assertRoleGrantAllowed, which checks this on both
 *  create and update. This is only so the UI never offers or opens an edit
 *  the server will 403 anyway; the backend is the real guard. */
function canTouchRole(callerRole: Role | undefined, targetRole: Role): boolean {
  return callerRole === 'superadmin' || (targetRole !== 'superadmin' && targetRole !== 'admin');
}

/**
 * Real staff accounts from backend/api (`GET/POST/PATCH /v1/staff/admins`) —
 * replaces the preset roster that used to live in `config/admins.ts`. Every
 * account is a real row (a login id + bcrypt-hashed password), created or
 * edited from this page (SUPERADMIN/ADMIN only — see admin.controller.ts).
 * There is no hard delete: "removing" an account deactivates it instead
 * (isActive: false), the same choice this console already makes for a
 * branch (StoresPage) — the login stops working immediately, but every
 * historical record that points at this id (audit log, lab bookings,
 * created_by/updated_by) stays intact instead of being orphaned.
 */
export default function AdminsPage() {
  const { user, accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listStaffAccounts(accessToken), [accessToken]);
  const rows = data ?? [];

  const { data: storeRows } = useAsync(() => listStores(accessToken), [accessToken]);
  const storeOptions = useMemo(
    () => (storeRows ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [storeRows],
  );

  const [search, setSearch] = useState('');
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  // 'new' creates a fresh login; an existing StaffAccount edits it; null
  // stays on the list. Both open the same full-page form.
  const [mode, setMode] = useState<StaffAccount | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const grantableRoles = useMemo(
    () => ROLES.filter((r) => canTouchRole(user?.role, r)),
    [user?.role],
  );

  function openAdd() {
    // Pharmacy is the account every branch actually needs day to day — the
    // default even for a Super Admin, who can still pick Super Admin/Admin
    // from the same picker when that's really what's needed.
    const defaultRole = grantableRoles.includes('pharmacy') ? 'pharmacy' : (grantableRoles[0] ?? 'pharmacy');
    setForm({ ...EMPTY_FORM, role: defaultRole });
    setFormError(null);
    setMode('new');
  }

  function openEdit(account: StaffAccount) {
    setForm({
      loginId: account.loginId,
      name: account.name,
      password: '',
      role: account.role,
      storeId: account.storeId ? String(account.storeId) : '',
    });
    setFormError(null);
    setMode(account);
  }

  function patchForm(patch: Partial<typeof EMPTY_FORM>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      // Clear the branch pick when switching to a role that isn't store-bound
      // — nothing should silently carry a branch onto a console-wide login.
      if (patch.role && !STORE_BOUND_ROLES.includes(next.role)) next.storeId = '';
      return next;
    });
  }

  async function submit() {
    setFormError(null);
    if (!form.loginId.trim() || !form.name.trim()) {
      setFormError('Login id and name are required.');
      return;
    }
    const editing = mode !== 'new' && mode !== null ? mode : null;
    if (!editing && !form.password) {
      setFormError('Password is required.');
      return;
    }
    if (form.password && form.password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (STORE_BOUND_ROLES.includes(form.role) && !form.storeId) {
      setFormError('Pick the branch this account works.');
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await updateStaffAccount(accessToken, editing.id, {
          loginId: form.loginId.trim(),
          name: form.name.trim(),
          ...(form.password ? { password: form.password } : {}),
          role: form.role,
          storeId: form.storeId ? Number(form.storeId) : null,
        });
      } else {
        await createStaffAccount(accessToken, {
          loginId: form.loginId.trim(),
          name: form.name.trim(),
          password: form.password,
          role: form.role,
          storeId: form.storeId ? Number(form.storeId) : undefined,
        });
      }
      setMode(null);
      reload();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : `Could not ${editing ? 'save' : 'create'} the account.`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  function toggleActive(account: StaffAccount) {
    const activating = !account.isActive;
    ask({
      title: activating ? 'Reactivate this account?' : 'Deactivate this account?',
      message: activating
        ? `"${account.name}" will be able to sign in again, with the same login id and password.`
        : `"${account.name}" (${account.loginId}) will no longer be able to sign in. Nothing it has already done — bookings, bills, audit entries — is affected, and this can be undone any time.`,
      confirmLabel: activating ? 'Reactivate' : 'Deactivate',
      danger: !activating,
      onConfirm: async () => {
        await updateStaffAccount(accessToken, account.id, { isActive: activating });
        reload();
      },
    });
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

  const columns: Column<StaffAccount>[] = [
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
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.isActive ? 'green' : 'gray'}>{row.isActive ? 'Active' : 'Deactivated'}</Badge>
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
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (row) => {
        const touchable = canTouchRole(user?.role, row.role);
        if (!touchable) return <span className="text-xs text-slate-300">—</span>;
        const self = row.id === user?.id;
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              title="Edit this account"
              onClick={() => openEdit(row)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <Icon name="edit" className="h-3.5 w-3.5" />
            </button>
            {!self && (
              <button
                type="button"
                title={row.isActive ? 'Deactivate this account' : 'Reactivate this account'}
                onClick={() => toggleActive(row)}
                className={
                  row.isActive
                    ? 'grid h-7 w-7 shrink-0 place-items-center rounded text-rose-400 hover:bg-rose-50 hover:text-rose-600'
                    : 'grid h-7 w-7 shrink-0 place-items-center rounded text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700'
                }
              >
                <Icon name={row.isActive ? 'logout' : 'rotate'} className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  if (mode !== null) {
    const editing = mode !== 'new' ? mode : null;
    return (
      <>
        <AddStaffPage
          editing={editing}
          form={form}
          patchForm={patchForm}
          grantableRoles={editing ? [...new Set([...grantableRoles, editing.role])] : grantableRoles}
          storeOptions={storeOptions}
          formError={formError}
          submitting={submitting}
          onCancel={() => setMode(null)}
          onSave={() => void submit()}
        />
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Staff Login"
        subtitle="Every staff login account — create as many as a branch needs, each its own login id and password."
        actions={
          <Button size="sm" onClick={openAdd}>
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
        <StatCard
          label="Lab / Appts"
          value={byRole('lab') + byRole('lab_technician') + byRole('appointments')}
          tone="amber"
        />
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
          Each account signs in with a login ID and password. A Super Admin or
          Admin account can only be edited or deactivated by a Super Admin.
        </p>
      </Card>
      {confirmDialog}
    </>
  );
}

/** Every option the role picker shows — [grantableRoles] already carries
 *  whatever the caller may grant, plus (while editing) the account's own
 *  current role even if it's otherwise off-limits, so editing doesn't look
 *  like it silently dropped the option it's already set to. */
function RolePicker({
  roles,
  value,
  onChange,
}: {
  roles: Role[];
  value: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map((role) => {
        const selected = value === role;
        return (
          <button
            key={role}
            type="button"
            onClick={() => onChange(role)}
            className={`rounded-lg border p-3 text-left transition ${
              selected
                ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500'
                : 'border-slate-300 hover:border-slate-400'
            }`}
          >
            <p className={`text-sm font-medium ${selected ? 'text-brand-700' : 'text-slate-800'}`}>
              {ROLE_LABELS[role]}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{ROLE_SUMMARY[role]}</p>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

/** The full-page "Add staff account" / "Edit staff account" form — a role
 *  picker up front (what this account's own login will be allowed to do is
 *  a real decision, not a detail to bury in a dialog), then a live preview
 *  of exactly which sidebar sections that role unlocks, so the choice is
 *  never a guess. [editing] null means this is a fresh account. */
function AddStaffPage({
  editing,
  form,
  patchForm,
  grantableRoles,
  storeOptions,
  formError,
  submitting,
  onCancel,
  onSave,
}: {
  editing: StaffAccount | null;
  form: typeof EMPTY_FORM;
  patchForm: (patch: Partial<typeof EMPTY_FORM>) => void;
  grantableRoles: Role[];
  storeOptions: { value: string; label: string }[];
  formError: string | null;
  submitting: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const storeBound = STORE_BOUND_ROLES.includes(form.role);
  const opensUp = allowedModules(form.role);

  return (
    <>
      <PageHeader
        title={editing ? `Edit ${editing.name}` : 'Add staff account'}
        subtitle={
          editing
            ? 'Change the role, branch, login id or password — leave the password blank to keep the current one.'
            : 'Create a login id and password, choose a role, and see exactly which sections it opens before saving.'
        }
        actions={
          <Button variant="secondary" disabled={submitting} onClick={onCancel}>
            Back to staff logins
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <div className="space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Login id">
                <input
                  value={form.loginId}
                  onChange={(e) => patchForm({ loginId: e.target.value })}
                  placeholder="e.g. pharmacy_mel"
                  className={inputClass}
                />
              </Field>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => patchForm({ name: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={editing ? 'New password — optional' : 'Password'}>
              <input
                type="password"
                value={form.password}
                onChange={(e) => patchForm({ password: e.target.value })}
                placeholder={editing ? 'Leave blank to keep the current password' : 'At least 8 characters'}
                className={inputClass}
              />
            </Field>

            <Field label="Role">
              <RolePicker
                roles={grantableRoles}
                value={form.role}
                onChange={(role) => patchForm({ role })}
              />
            </Field>

            {storeBound && (
              <Field label="Branch">
                <select
                  value={form.storeId}
                  onChange={(e) => patchForm({ storeId: e.target.value })}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">Select a branch…</option>
                  {storeOptions.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-400">
                  This account signs in as {ROLE_LABELS[form.role]} for the branch chosen here.
                </p>
              </Field>
            )}

            {formError && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
            <Button variant="secondary" disabled={submitting} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" disabled={submitting} onClick={onSave}>
              {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create account'}
            </Button>
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader
            title={`What ${ROLE_LABELS[form.role]} can open`}
            subtitle={ROLE_SUMMARY[form.role]}
          />
          <div className="flex flex-wrap gap-1.5 p-4">
            {opensUp.map((m) => (
              <span
                key={m.key}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                title={m.description}
              >
                {m.label}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
