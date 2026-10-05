import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatCurrency } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listOrders } from '@/api/orders';
import { cashPendingOf } from '@/lib/billCash';
import { ReceivePaymentModal } from '@/components/orders/ReceivePaymentModal';
import type { Order } from '@/types';

/**
 * The Manual cash report on its own full page: every priced bill, with how
 * each one was settled — what the member's wallet covered, and what is still
 * owed in cash at the counter. Its own search and branch filter; a Receive
 * button on each row opens the status and payment panel.
 */
export default function ManualCashPage() {
  const navigate = useNavigate();
  const { user, accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listOrders(accessToken), [accessToken]);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [store, setStore] = useState('all');
  const [receiving, setReceiving] = useState<Order | null>(null);

  // Only the cash still to be received: a bill whose wallet share already
  // covers it, or whose cash has been taken, has nothing left to collect here.
  const scoped = useMemo(
    () =>
      scopeToStore(
        rows.filter((o) => o.convertedToBillAt && cashPendingOf(o) > 0),
        user,
      ),
    [rows, user],
  );
  const branchBound = user?.role === 'pharmacy' && Boolean(user.storeCode);

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of scoped) if (o.storeCode) seen.set(o.storeCode, o.storeName);
    return [
      { value: 'all', label: 'All branches' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q);
      const matchesStore = store === 'all' || row.storeCode === store;
      return matchesQuery && matchesStore;
    });
  }, [scoped, search, store]);

  const columns: Column<Order>[] = [
    {
      key: 'id',
      header: 'ID',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500">
          {row.billId ? `#${row.billId}` : '—'}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'Order',
      render: (row) => <span className="font-medium text-slate-800">{row.code}</span>,
    },
    {
      key: 'member',
      header: 'Member',
      render: (row) => <span className="text-slate-800">{row.memberName}</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (row) => <span className="text-slate-600">{row.memberPhone}</span>,
    },
    {
      key: 'total',
      header: 'Total bill',
      render: (row) => (
        <span className="font-medium text-slate-800">{formatCurrency(row.billAmount)}</span>
      ),
    },
    {
      key: 'wallet',
      header: 'Wallet redeemed',
      render: (row) => (
        <span className="text-slate-700">{formatCurrency(row.billWalletCollected)}</span>
      ),
    },
    {
      key: 'cash',
      header: 'Cash pending',
      render: (row) => {
        const pending = cashPendingOf(row);
        return (
          <span className={pending > 0 ? 'font-medium text-amber-700' : 'text-slate-500'}>
            {formatCurrency(pending)}
          </span>
        );
      },
    },
    {
      key: 'receive',
      header: '',
      render: (row) => (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setReceiving(row);
            }}
          >
            Receive
          </Button>
        </div>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Manual cash"
        subtitle="Priced bills and how each one is settled — wallet covered, cash still owed at the counter."
        actions={
          <Button variant="ghost" onClick={() => navigate('/bills')}>
            ← Back to bills
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search order code, member, phone…"
          />
          {!branchBound && (
            <FilterSelect value={store} onChange={setStore} options={storeOptions} />
          )}
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No priced bills match these filters."
        />
      </Card>

      {receiving && (
        <ReceivePaymentModal
          order={receiving}
          open={Boolean(receiving)}
          onClose={() => setReceiving(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
