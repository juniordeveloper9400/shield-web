import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { listAuditLog, type AuditAction, type AuditLogEntry } from '@/api/auditLog';

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Every action' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGIN_FAILED', label: 'Failed login' },
  { value: 'CREATE', label: 'Create' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
];

const ACTION_TONE: Record<AuditAction, Tone> = {
  LOGIN: 'green',
  LOGIN_FAILED: 'red',
  CREATE: 'blue',
  UPDATE: 'amber',
  DELETE: 'red',
};

const ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: 'Login',
  LOGIN_FAILED: 'Failed login',
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
};

function statusTone(status: number): Tone {
  if (status >= 500) return 'red';
  if (status >= 400) return 'amber';
  return 'green';
}

/**
 * The Super Admin's own report: every staff login (success and failure)
 * and every create/update/delete across the whole console, newest first —
 * reads backend/api's `GET /v1/staff/audit-log`, which SUPERADMIN alone can
 * call (see that route's own doc on why not ADMIN too). Filtering and
 * pagination both happen server-side; this page never tries to hold the
 * whole table in memory.
 */
export default function AuditLogPage() {
  const { accessToken } = useAuth();

  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  async function load(reset: boolean) {
    if (reset) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const res = await listAuditLog(
        {
          q: search.trim() || undefined,
          action: (action || undefined) as AuditAction | undefined,
          from: from || undefined,
          to: to || undefined,
          cursor: reset ? undefined : cursor ?? undefined,
        },
        accessToken,
      );
      setRows((prev) => (reset ? res.items : [...prev, ...res.items]));
      setNextCursor(res.nextCursor);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the audit log.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // Reload from the top whenever a filter changes — debounced lightly for
  // the free-text search box so every keystroke doesn't fire its own request.
  useEffect(() => {
    const t = setTimeout(() => void load(true), search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, action, from, to, accessToken]);

  const counts = {
    total: rows.length,
    logins: rows.filter((r) => r.action === 'LOGIN').length,
    failedLogins: rows.filter((r) => r.action === 'LOGIN_FAILED').length,
    changes: rows.filter((r) => r.action === 'CREATE' || r.action === 'UPDATE' || r.action === 'DELETE').length,
  };

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'staff',
      header: 'Staff',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.staffName}</p>
          <p className="text-xs text-slate-400">
            <code className="rounded bg-slate-100 px-1 py-0.5">{row.staffLoginId}</code>
            {row.staffRole ? ` · ${row.staffRole.toLowerCase()}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => <Badge tone={ACTION_TONE[row.action]}>{ACTION_LABEL[row.action]}</Badge>,
    },
    {
      key: 'path',
      header: 'What',
      render: (row) => (
        <div>
          <code className="text-xs text-slate-600">
            {row.method} {row.path}
          </code>
          <span className="ml-2 inline-block">
            <Badge tone={statusTone(row.statusCode)}>{row.statusCode}</Badge>
          </span>
        </div>
      ),
    },
    {
      key: 'when',
      header: 'When',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'go',
      header: '',
      render: (row) =>
        row.requestBody != null ? (
          <button
            type="button"
            className="text-xs font-medium text-brand-600"
            onClick={() => setSelected(row)}
          >
            View →
          </button>
        ) : null,
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Every staff login and every change across the console — who, when, and what was sent."
        actions={
          <Button variant="secondary" onClick={() => void load(true)} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Entries loaded" value={counts.total} icon="accounts" tone="blue" />
        <StatCard label="Logins" value={counts.logins} icon="check" tone="green" />
        <StatCard label="Failed logins" value={counts.failedLogins} tone="rose" />
        <StatCard label="Changes" value={counts.changes} tone="amber" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search staff name, login id or path…" />
          <FilterSelect value={action} onChange={setAction} options={ACTION_OPTIONS} />
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          error={error}
          empty="No matching audit log entries."
        />
        {nextCursor && (
          <div className="flex justify-center border-t border-slate-200 p-3">
            <Button variant="secondary" size="sm" onClick={() => void load(false)} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </Card>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${ACTION_LABEL[selected.action]} · ${selected.method} ${selected.path}` : ''}
        footer={
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
              <div>
                <p className="font-semibold uppercase tracking-wide">Staff</p>
                <p className="text-slate-700">
                  {selected.staffName} ({selected.staffLoginId})
                </p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide">When</p>
                <p className="text-slate-700">{formatDateTime(selected.createdAt)}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide">Status</p>
                <p className="text-slate-700">{selected.statusCode}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide">IP</p>
                <p className="text-slate-700">{selected.ip || '—'}</p>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Request body</p>
              <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(selected.requestBody, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
