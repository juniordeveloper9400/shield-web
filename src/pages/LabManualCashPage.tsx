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
import { listLabBookings } from '@/api/labBookings';
import { cashPendingOf } from '@/lib/billCash';
import { LabReceivePaymentModal } from '@/components/labs/LabReceivePaymentModal';
import type { LabBooking } from '@/types';

/**
 * The lab twin of Bills → Manual cash: every priced lab bill that still owes
 * money at the counter, with what the member's wallet already covered and what
 * is left to take as UPI or cash. A Receive button on each row opens the same
 * UPI / cash panel the payment step of Lab Bills uses.
 */
export default function LabManualCashPage() {
  const navigate = useNavigate();
  const { user, accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listLabBookings(accessToken), [accessToken]);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [store, setStore] = useState('all');
  const [receiving, setReceiving] = useState<LabBooking | null>(null);

  // Only the cash still to be received: a bill the wallet already covered, or
  // whose cash has been taken, has nothing left to collect here.
  const scoped = useMemo(
    () => scopeToStore(rows.filter((r) => r.billAmount > 0 && cashPendingOf(r) > 0), user),
    [rows, user],
  );
  const branchBound = user?.role === 'lab_technician' && Boolean(user.storeCode);

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of scoped) if (r.storeCode) seen.set(r.storeCode, r.storeName);
    return [{ value: 'all', label: 'All branches' }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q);
      return matchesQuery && (store === 'all' || row.storeCode === store);
    });
  }, [scoped, search, store]);

  const columns: Column<LabBooking>[] = [
    { key: 'code', header: 'Booking', render: (row) => <span className="font-medium text-slate-800">{row.code}</span> },
    { key: 'member', header: 'Member', render: (row) => <span className="text-slate-800">{row.memberName}</span> },
    { key: 'phone', header: 'Phone', render: (row) => <span className="text-slate-600">{row.memberPhone}</span> },
    { key: 'package', header: 'Package', render: (row) => <span className="text-slate-700">{row.packageName}</span> },
    {
      key: 'total',
      header: 'Total bill',
      render: (row) => <span className="font-medium text-slate-800">{formatCurrency(row.billAmount)}</span>,
    },
    {
      key: 'wallet',
      header: 'Wallet redeemed',
      render: (row) => <span className="text-slate-700">{formatCurrency(row.billWalletCollected)}</span>,
    },
    {
      key: 'cash',
      header: 'Cash pending',
      render: (row) => <span className="font-medium text-amber-700">{formatCurrency(cashPendingOf(row))}</span>,
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
        title="Lab manual cash"
        subtitle="Priced lab bills and how each one is settled — wallet covered, cash still owed at the counter."
        actions={
          <Button variant="ghost" onClick={() => navigate('/lab-bills')}>
            ← Back to lab bills
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search booking code, member, phone…" />
          {!branchBound && <FilterSelect value={store} onChange={setStore} options={storeOptions} />}
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No lab bills are waiting for cash."
        />
      </Card>

      {receiving && (
        <LabReceivePaymentModal
          bookingId={receiving.id}
          code={receiving.code}
          billAmount={receiving.billAmount}
          owed={cashPendingOf(receiving)}
          open
          onClose={() => setReceiving(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
