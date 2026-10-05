import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  getCommissionReserve,
  type CommissionReserveEntry,
  type CommissionReserveStore,
} from '@/api/commissionReserve';

/**
 * The company's own money from Health Pass activations — never shown to a
 * member or an agent anywhere in the app itself, only here. Every approved
 * activation adds 8% of its load; an agent sale can also leave part of its
 * commission pool unspent. Each amount is held against the store its
 * activation was made at.
 *
 * Admins see every store and the grand total. A branch's own admin sees only
 * its store's reserve, with that store's figures as the totals.
 */
export default function CommissionReservePage() {
  const { user } = useAuth();
  const reserve = useAsync(getCommissionReserve, []);

  const scopedEntries = useMemo(
    () => scopeToStore(reserve.data?.entries ?? [], user),
    [reserve.data, user],
  );
  const scopedStores = useMemo(
    () => scopeToStore(reserve.data?.byStore ?? [], user),
    [reserve.data, user],
  );
  const totals = useMemo(() => {
    const sum = (list: { amount?: number; total?: number; companyShare?: number; poolLeftover?: number }[], key: 'amount' | 'companyShare' | 'poolLeftover' | 'total') =>
      list.reduce((s, x) => s + (Number(x[key]) || 0), 0);
    const entriesSum = (source: 'COMPANY_SHARE' | 'POOL_LEFTOVER') =>
      scopedEntries.filter((e) => e.source === source).reduce((s, e) => s + e.amount, 0);
    return {
      total: sum(scopedStores, 'total'),
      companyShare: entriesSum('COMPANY_SHARE'),
      poolLeftover: entriesSum('POOL_LEFTOVER'),
    };
  }, [scopedEntries, scopedStores]);
  const entries = scopedEntries;

  const storeColumns: Column<CommissionReserveStore>[] = [
    {
      key: 'store',
      header: 'Store',
      render: (row) => (
        <div>
          <p className="text-slate-800">{row.storeName}</p>
          {row.storeCode && <p className="text-xs text-slate-400">{row.storeCode}</p>}
        </div>
      ),
    },
    {
      key: 'company',
      header: 'Company 8%',
      render: (row) => formatCurrency(row.companyShare),
      className: 'text-right',
    },
    {
      key: 'pool',
      header: 'Agent pool leftover',
      render: (row) => formatCurrency(row.poolLeftover),
      className: 'text-right',
    },
    {
      key: 'total',
      header: 'Store reserve',
      render: (row) => (
        <span className="font-semibold text-slate-900">{formatCurrency(row.total)}</span>
      ),
      className: 'text-right',
    },
  ];

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
          value={reserve.data ? formatCurrency(totals.total) : '—'}
          hint={`Sum of the ${entries.length} entries below`}
          icon="accounts"
          tone="blue"
        />
        <StatCard
          label="Company share (8%)"
          value={reserve.data ? formatCurrency(totals.companyShare) : '—'}
          hint="8% of every approved Health Pass activation"
          icon="wallet"
          tone="green"
        />
        <StatCard
          label="Agent pool leftover"
          value={reserve.data ? formatCurrency(totals.poolLeftover) : '—'}
          hint="Unspent part of agent sales' commission pools"
          icon="users"
          tone="violet"
        />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Reserve by store"
          subtitle="Each store's own reserve — the amount held against the activations made at that branch."
        />
        <DataTable
          columns={storeColumns}
          rows={scopedStores}
          loading={reserve.loading}
          error={reserve.error}
          empty="No store has reserve yet."
        />
      </Card>

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
