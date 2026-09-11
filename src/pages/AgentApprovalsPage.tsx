import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { Tabs } from '@/components/ui/Tabs';
import { formatDate, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listApprovedAgents, listPendingAgents } from '@/api/agents';
import type { AgentRow, PendingAgent } from '@/types';

const LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Every level' },
  { value: 'national', label: 'National' },
  { value: 'region', label: 'Region' },
  { value: 'state', label: 'State' },
  { value: 'district', label: 'District' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'lsgd', label: 'LSGD' },
  { value: 'ward', label: 'Ward' },
];

export default function AgentApprovalsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');

  const pending = useAsync(listPendingAgents, []);
  const pendingRows = useMemo(() => pending.data ?? [], [pending.data]);

  const approved = useAsync(listApprovedAgents, []);
  const approvedRows = useMemo(() => approved.data ?? [], [approved.data]);

  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const filteredPending = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pendingRows;
    return pendingRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.phone.includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.area.toLowerCase().includes(q) ||
        r.parentName.toLowerCase().includes(q),
    );
  }, [pendingRows, search]);

  const filteredApproved = useMemo(() => {
    const q = search.trim().toLowerCase();
    return approvedRows.filter((r) => {
      if (levelFilter && r.level !== levelFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.phone.includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.area.toLowerCase().includes(q) ||
        r.parentName.toLowerCase().includes(q)
      );
    });
  }, [approvedRows, search, levelFilter]);

  const pendingColumns: Column<PendingAgent>[] = [
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

  const approvedColumns: Column<AgentRow>[] = [
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
      header: 'Level',
      render: (row) => <Badge tone="blue">{titleCase(row.level)}</Badge>,
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
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.active ? 'green' : 'gray'}>
          {row.active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'go',
      header: '',
      render: () => (
        <span className="text-xs font-medium text-brand-600">Manage →</span>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Agent approvals"
        subtitle="New agents awaiting a position & approval, and everyone already live in the tree."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Awaiting approval"
          value={pendingRows.length}
          icon="alert"
          tone="amber"
        />
        <StatCard
          label="Agents in the tree"
          value={approvedRows.length}
          icon="users"
          tone="blue"
        />
      </div>

      <Card>
        <div className="border-b border-slate-200 px-4 pt-3">
          <Tabs
            items={[
              { key: 'pending', label: 'Pending approval', count: pendingRows.length },
              { key: 'all', label: 'All agents', count: approvedRows.length },
            ]}
            active={tab}
            onChange={(key) => setTab(key as 'pending' | 'all')}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, phone, code, position…"
          />
          {tab === 'all' && (
            <FilterSelect
              value={levelFilter}
              onChange={setLevelFilter}
              options={LEVEL_OPTIONS}
            />
          )}
        </div>
        {tab === 'pending' ? (
          <DataTable
            columns={pendingColumns}
            rows={filteredPending}
            loading={pending.loading}
            error={pending.error}
            empty="No agents are awaiting approval."
            onRowClick={(row) => navigate(`/agent-approvals/${row.id}`)}
          />
        ) : (
          <DataTable
            columns={approvedColumns}
            rows={filteredApproved}
            loading={approved.loading}
            error={approved.error}
            empty="No agents match this filter."
            onRowClick={(row) => navigate(`/agents/${row.id}`)}
          />
        )}
      </Card>
    </>
  );
}
