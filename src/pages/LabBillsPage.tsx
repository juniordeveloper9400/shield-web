import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { LabBookingModal } from '@/components/labs/LabBookingModal';
import { useAsync } from '@/lib/useAsync';
import { listLabBookings } from '@/api/labBookings';
import type { LabBooking, PaymentStatus } from '@/types';

const BILL_OPTIONS = [
  { value: 'all', label: 'All bills' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Awaiting payment' },
];

/**
 * Every lab booking that has been converted to a bill, in one place — the
 * lab's own counterpart to the standard Bills page. A booking gets here only
 * through "Convert to bill →" on its own Lab Orders card (LabBookingModal) —
 * pricing, the invoice photo and the OTP-gated wallet collection all happen
 * there already, so unlike a standard order's Bills page this one has no
 * separate editor: "Manage" reopens the exact same modal Lab Orders uses,
 * already showing its Billing section since the booking is already billed.
 */
export default function LabBillsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listLabBookings, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [store, setStore] = useState('all');
  const [billFilter, setBillFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A booking only counts as "billed" the same way LabBookingModal's own
  // `billed` flag does — see its doc on why total, not status, is the check
  // (a bill can be sent and awaiting payment before it's ever marked paid).
  const billedRows = useMemo(() => rows.filter((r) => r.billAmount > 0), [rows]);
  const scoped = useMemo(() => scopeToStore(billedRows, user), [billedRows, user]);
  const branchBound = user?.role === 'lab_technician' && Boolean(user.storeCode);

  const selected = scoped.find((r) => r.id === selectedId) ?? null;

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of scoped) if (r.storeCode) seen.set(r.storeCode, r.storeName);
    return [
      { value: 'all', label: 'All branches' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [scoped]);

  const billStatusOf = (row: LabBooking): PaymentStatus =>
    row.billStatus === 'paid' ? 'paid' : 'pending';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q);
      const matchesStore = store === 'all' || row.storeCode === store;
      const matchesBill = billFilter === 'all' || billStatusOf(row) === billFilter;
      return matchesQuery && matchesStore && matchesBill;
    });
  }, [scoped, search, store, billFilter]);

  const paidCount = scoped.filter((r) => billStatusOf(r) === 'paid').length;
  const pendingCount = scoped.length - paidCount;
  const totalBilled = scoped.reduce((sum, r) => sum + r.totalPrice, 0);

  const columns: Column<LabBooking>[] = [
    {
      key: 'code',
      header: 'Booking',
      render: (row) => <span className="font-medium text-slate-800">{row.code}</span>,
    },
    {
      key: 'member',
      header: 'Member',
      render: (row) => (
        <div>
          <p className="text-slate-800">{row.memberName}</p>
          <p className="text-xs text-slate-400">{row.memberPhone}</p>
        </div>
      ),
    },
    { key: 'package', header: 'Package', render: (row) => row.packageName },
    ...(branchBound
      ? []
      : ([
          {
            key: 'branch',
            header: 'Branch',
            render: (row) => row.storeName || <span className="text-slate-400">—</span>,
          },
        ] as Column<LabBooking>[])),
    {
      key: 'total',
      header: 'Bill total',
      render: (row) => formatCurrency(row.totalPrice),
      className: 'text-right',
    },
    {
      key: 'billed',
      header: 'Billed',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">{formatDateTime(row.createdAt)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
        billStatusOf(row) === 'paid' ? (
          <Badge tone="green">Paid</Badge>
        ) : (
          <Badge tone="amber">Awaiting payment</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button
          type="button"
          className="text-xs font-medium text-brand-600"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(row.id);
          }}
        >
          Manage
        </button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Lab Bills"
        subtitle={
          branchBound
            ? 'Lab bookings converted to bills for your branch — price, send and collect payment from the booking itself.'
            : 'Lab bookings converted to bills, across every branch.'
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total billed" value={formatCurrency(totalBilled)} icon="receipt" tone="blue" />
        <StatCard label="Paid" value={paidCount} icon="check" tone="green" />
        <StatCard label="Awaiting payment" value={pendingCount} icon="alert" tone="amber" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search booking, member, package…"
          />
          <div className="flex flex-wrap gap-2">
            {!branchBound && (
              <FilterSelect value={store} onChange={setStore} options={storeOptions} />
            )}
            <FilterSelect value={billFilter} onChange={setBillFilter} options={BILL_OPTIONS} />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty={
            scoped.length === 0
              ? 'No lab bookings have been converted to a bill yet. Open a booking on Lab Orders and choose "Convert to bill".'
              : 'No bills match your filters.'
          }
          onRowClick={(row) => setSelectedId(row.id)}
        />
      </Card>

      <LabBookingModal
        booking={selected}
        onClose={() => setSelectedId(null)}
        onChanged={reload}
      />
    </>
  );
}
