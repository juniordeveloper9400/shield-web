import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatCurrency, formatDateTime, titleCase, toneForStatus } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listOrders } from '@/api/orders';
import { OrderReviewModal } from '@/components/orders/OrderReviewModal';
import type { Order } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'processing', label: 'Processing' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const FULFILLMENT_OPTIONS = [
  { value: 'all', label: 'All delivery types' },
  { value: 'home_delivery', label: 'Home Delivery' },
  { value: 'store_pickup', label: 'Store Pickup' },
];

export default function OrdersPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listOrders, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [fulfillment, setFulfillment] = useState('all');
  const [store, setStore] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Standard orders only — a prescription becomes its own `app."order"` row
  // too (kind PRESCRIPTION) the moment it's ordered, which used to make it
  // show up here as well as on the Prescriptions page. It's reviewed and
  // billed entirely from there (`PrescriptionReviewModal`), so it has no
  // reason to also appear here.
  const scoped = useMemo(
    () => scopeToStore(rows.filter((o) => o.kind === 'standard'), user),
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

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q);
      const matchesStatus = status === 'all' || row.status === status;
      const matchesFulfillment =
        fulfillment === 'all' || row.fulfillmentType === fulfillment;
      const matchesStore = store === 'all' || row.storeCode === store;
      return matchesQuery && matchesStatus && matchesFulfillment && matchesStore;
    });
  }, [scoped, search, status, fulfillment, store]);

  const counts = {
    processing: scoped.filter((r) => r.status === 'processing').length,
    out: scoped.filter((r) => r.status === 'out_for_delivery').length,
    delivered: scoped.filter((r) => r.status === 'delivered').length,
    cancelled: scoped.filter((r) => r.status === 'cancelled').length,
  };

  const columns: Column<Order>[] = [
    {
      key: 'code',
      header: 'Order',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.code}</p>
          {/* Every row here is a standard order now (prescriptions have their
              own page) — the kind has nothing left to say. */}
          <p className="text-xs text-slate-400">{formatDateTime(row.placedAt)}</p>
        </div>
      ),
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
    ...(branchBound
      ? []
      : [
          {
            key: 'branch',
            header: 'Branch',
            render: (row: Order) => row.storeName,
          } as Column<Order>,
        ]),
    {
      key: 'fulfillment',
      header: 'Delivery Type',
      render: (row) => (
        <Badge tone={row.fulfillmentType === 'home_delivery' ? 'blue' : 'gray'}>
          {row.fulfillmentType === 'home_delivery' ? 'Home Delivery' : 'Store Pickup'}
        </Badge>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (row) => row.itemCount,
      className: 'text-right',
    },
    {
      key: 'paid',
      header: 'Paid',
      render: (row) => formatCurrency(row.paidTotal),
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={toneForStatus(row.status)}>{titleCase(row.status)}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            // The row itself now opens the same modal on click; stop this
            // from also bubbling into that handler and firing it twice.
            e.stopPropagation();
            setSelectedId(row.id);
          }}
        >
          Manage
        </Button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={
          branchBound
            ? 'Member orders billed to your branch.'
            : 'Member orders across every branch.'
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Processing" value={counts.processing} icon="alert" tone="amber" />
        <StatCard label="Out for delivery" value={counts.out} icon="orders" tone="blue" />
        <StatCard label="Delivered" value={counts.delivered} icon="check" tone="green" />
        <StatCard label="Cancelled" value={counts.cancelled} tone="rose" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search order code, member, phone…"
          />
          <div className="flex flex-wrap gap-2">
            {!branchBound && (
              <FilterSelect value={store} onChange={setStore} options={storeOptions} />
            )}
            <FilterSelect value={fulfillment} onChange={setFulfillment} options={FULFILLMENT_OPTIONS} />
            <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No orders match your filters."
          onRowClick={(row) => setSelectedId(row.id)}
        />
      </Card>

      {selected && (
        <OrderReviewModal
          key={selected.id}
          order={selected}
          onClose={() => setSelectedId(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
