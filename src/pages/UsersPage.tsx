import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatDateTime, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listUsers } from '@/api/users';
import type { AppUser } from '@/types';

const PERSONA_OPTIONS = [
  { value: 'all', label: 'All personas' },
  { value: 'member', label: 'Members' },
  { value: 'agent', label: 'Agents' },
  { value: 'investor', label: 'Investors' },
];

const PERSONA_TONE = { member: 'gray', agent: 'green', investor: 'violet' } as const;

export default function UsersPage() {
  const { data, loading, error } = useAsync(listUsers, []);
  const navigate = useNavigate();
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [persona, setPersona] = useState('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !q ||
        row.name.toLowerCase().includes(q) ||
        row.phone.includes(q) ||
        row.email.toLowerCase().includes(q) ||
        row.agentCode.toLowerCase().includes(q) ||
        row.investorCode.toLowerCase().includes(q);
      const matchesPersona = persona === 'all' || row.persona === persona;
      return matchesQuery && matchesPersona;
    });
  }, [rows, search, persona]);

  const counts = {
    total: rows.length,
    agents: rows.filter((r) => r.persona === 'agent').length,
    investors: rows.filter((r) => r.persona === 'investor').length,
    registered: rows.filter((r) => r.registered).length,
  };

  const columns: Column<AppUser>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-400">
            {row.phone}
            {row.email ? ` · ${row.email}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'persona',
      header: 'Persona',
      render: (row) => (
        <Badge tone={PERSONA_TONE[row.persona]}>
          {titleCase(row.persona)}
          {row.persona === 'agent' && row.agentCode ? ` · ${row.agentCode}` : ''}
          {row.persona === 'investor' && row.investorCode
            ? ` · ${row.investorCode}`
            : ''}
        </Badge>
      ),
    },
    { key: 'branch', header: 'Home branch', render: (row) => row.homeStoreName },
    {
      key: 'registered',
      header: 'Registered',
      render: (row) => (row.registered ? 'Yes' : '—'),
    },
    {
      key: 'joined',
      header: 'Joined',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'go',
      header: '',
      render: () => (
        <span className="text-xs font-medium text-brand-600">Open →</span>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="App members, and converting them to an agent or investor persona."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Members" value={counts.total} icon="users" tone="blue" />
        <StatCard label="Registered" value={counts.registered} icon="check" tone="green" />
        <StatCard label="Agents" value={counts.agents} tone="green" />
        <StatCard label="Investors" value={counts.investors} tone="violet" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, phone, email, code…"
          />
          <FilterSelect value={persona} onChange={setPersona} options={PERSONA_OPTIONS} />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No users match your filters."
          onRowClick={(row) => navigate(`/users/${row.id}`)}
        />
      </Card>
    </>
  );
}
