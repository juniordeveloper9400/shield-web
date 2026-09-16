import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { getCommissionReserve, type CommissionReserveEntry } from '@/api/commissionReserve';

/**
 * The company's own share of every agent's Health Pass sale — never shown
 * to a member or an agent anywhere in the app itself, only here. See
 * `app.commission_reserve_entry`'s own doc (migration 0032/0033) for
 * exactly how each row's amount is worked out.
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
        subtitle="The company's own share of every agent's Health Pass sale — never surfaced to a member or an agent, only here."
      />

      {reserve.error && (
        <Card className="mb-6 border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
          {reserve.error}
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Total reserved"
          value={reserve.data ? formatCurrency(reserve.data.total) : '—'}
          hint="Sum of every reserve entry below"
          icon="accounts"
          tone="blue"
        />
        <StatCard
          label="Entries"
          value={String(entries.length)}
          hint="One per approved Health Pass activation with a share left over"
          icon="wallet"
          tone="violet"
        />
      </div>

      <Card>
        <CardHeader
          title="Reserve entries"
          subtitle="Newest first — what each activation's commission pool left over once the selling agent, and the national agent's override where it applies, were paid"
        />
        <DataTable
          columns={columns}
          rows={entries}
          loading={reserve.loading}
          error={reserve.error}
          empty="No Health Pass activation has generated a reserved share yet."
        />
      </Card>
    </>
  );
}
