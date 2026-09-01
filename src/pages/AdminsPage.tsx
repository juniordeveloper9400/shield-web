import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import { initials } from '@/lib/format';
import {
  MODULES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_SUMMARY,
  canAccess,
} from '@/config/permissions';
import { ADMIN_CREDENTIALS } from '@/config/admins';
import type { Role } from '@/types';

const ROLES = Object.keys(ROLE_LABELS) as Role[];

const ROLE_COLOR: Record<Role, string> = {
  superadmin: '#2c57a6',
  pharmacy: '#1f7a4d',
  lab: '#8a5b1f',
  appointments: '#6b3fa0',
};

interface AdminRow {
  id: string;
  loginId: string;
  name: string;
  role: Role;
  storeCode?: string;
}

/**
 * A read-only view of the preset logins in `src/config/admins.ts`. Editing the
 * roster — adding a login, changing a role or a password — is done in that
 * file; the console authenticates against it directly.
 */
export default function AdminsPage() {
  const rows = useMemo<AdminRow[]>(
    () =>
      ADMIN_CREDENTIALS.map((c) => ({
        id: c.loginId.toLowerCase(),
        loginId: c.loginId.toLowerCase(),
        name: c.name,
        role: c.role,
        storeCode: c.role === 'pharmacy' ? c.storeCode : undefined,
      })),
    [],
  );

  const [search, setSearch] = useState('');

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
        subtitle="Preset logins for the console. Edit them in src/config/admins.ts."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Total logins" value={rows.length} icon="admins" tone="blue" />
        <StatCard label="Super Admins" value={byRole('superadmin')} icon="check" tone="green" />
        <StatCard label="Pharmacy" value={byRole('pharmacy')} tone="violet" />
        <StatCard label="Lab / Appts" value={byRole('lab') + byRole('appointments')} tone="amber" />
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
            placeholder="Search name, email or branch…"
          />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={false}
          error={null}
          empty="No logins match your search."
        />
        <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-400">
          Passwords are set per login in <code>src/config/admins.ts</code>. Add or
          remove a login there and redeploy — the console reads that file directly.
        </p>
      </Card>
    </>
  );
}
