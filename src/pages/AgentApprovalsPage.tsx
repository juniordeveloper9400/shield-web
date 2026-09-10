import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput } from '@/components/ui/Filters';
import { formatDate, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listPendingAgents } from '@/api/agents';
import type { PendingAgent } from '@/types';

export default function AgentApprovalsPage() {
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(listPendingAgents, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.phone.includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.area.toLowerCase().includes(q) ||
        r.parentName.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const columns: Column<PendingAgent>[] = [
    {
      key: 'agent',
      header: 'Agent',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-400">
            {row.code} · {row.phone}
          </p>
        </div>
      ),
    },
    {
      key: 'level',
      header: 'Requested level',
      render: (row) => <Badge tone="gray">{titleCase(row.level)}</Badge>,
    },
    {
      key: 'area',
      header: 'Position',
      render: (row) => row.area || '—',
    },
    {
      key: 'parent',
      header: 'Reports to',
      render: (row) =>
        row.parentName ? (
          <span>
            {row.parentName}
            <span className="text-xs text-slate-400"> · {row.parentCode}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: 'go',
      header: '',
      render: () => (
        <span className="text-xs font-medium text-brand-600">Review →</span>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Agent approvals"
        subtitle="New agents registered in the app — review the KYC, set the position, approve or reject."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Awaiting approval"
          value={rows.length}
          icon="alert"
          tone="amber"
        />
      </div>

      <Card>
        <div className="border-b border-slate-200 p-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, phone, code, position…"
          />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No agents are awaiting approval."
          onRowClick={(row) => navigate(`/agent-approvals/${row.id}`)}
        />
      </Card>
    </>
  );
}
