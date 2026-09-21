import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { getCommissionReserve, type CommissionReserveEntry } from '@/api/commissionReserve';

/**
 * The company's own money from Health Pass activations — never shown to a
 * member or an agent anywhere in the app itself, only here. Every approved
 * activation adds 8% of its load; an agent sale can also leave part of its
 * commission pool unspent. See `app.commission_reserve_entry`'s own doc
 * (migrations 0032/0033/0053) for exactly how each row's amount is worked out.
 */
export default function CommissionReservePage() {
  const reserve = useAsync(getCommissionReserve, []);
  const entries = reserve.data?.entries ?? [];

  const columns: Column<CommissionReserveEntry>[] = [
    {
      key: 'when',
      header: 'Date',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'member',
      header: 'Activation',
      render: (row) => (
        <div>
          <p className="text-slate-800">{row.memberName}</p>
          <p className="text-xs text-slate-400">
            {row.memberPhone} · {row.tierName}
          </p>
        </div>
      ),
    },
    {
      key: 'card',
      header: 'Wallet card',
      render: (row) => <span className="text-xs text-slate-400">#{row.walletCardId}</span>,
    },
    {
      key: 'source',
      header: 'Source',
      render: (row) =>
        row.source === 'COMPANY_SHARE' ? (
          <Badge tone="green">Company 8%</Badge>
        ) : (
          <Badge tone="gray">Agent pool leftover</Badge>
        ),
    },
    {
      key: 'amount',
      header: 'Reserved',
      render: (row) => (
        <span className="font-semibold text-slate-900">{formatCurrency(row.amount)}</span>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Reserved"
        subtitle="The company's own share of every Health Pass activation — never surfaced to a member or an agent, only here."
      />

      {reserve.error && (
        <Card className="mb-6 border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
          {reserve.error}
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total reserved"
          value={reserve.data ? formatCurrency(reserve.data.total) : '—'}
          hint={`Sum of the ${entries.length} entries below`}
          icon="accounts"
          tone="blue"
        />
        <StatCard
          label="Company share (8%)"
          value={reserve.data ? formatCurrency(reserve.data.companyShare) : '—'}
          hint="8% of every approved Health Pass activation"
          icon="wallet"
          tone="green"
        />
        <StatCard
          label="Agent pool leftover"
          value={reserve.data ? formatCurrency(reserve.data.poolLeftover) : '—'}
          hint="Unspent part of agent sales' commission pools"
          icon="users"
          tone="violet"
        />
      </div>

      <Card>
        <CardHeader
          title="Reserve entries"
          subtitle="Newest first — the company's 8% of each approved activation, and, for agent sales, what the commission pool left over once the seller and the up-line were paid"
        />
        <DataTable
          columns={columns}
          rows={entries}
          loading={reserve.loading}
          error={reserve.error}
          empty="No Health Pass activation has been approved yet."
        />
      </Card>
    </>
  );
}
