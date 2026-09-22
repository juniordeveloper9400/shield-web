import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DetailList } from '@/components/ui/DetailList';
import { FilterSelect } from '@/components/ui/Filters';
import { formatCurrency, formatDateTime, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  assignDeliveryBoy,
  listAssignedToMe,
  listAvailableForDelivery,
  listDeliveryBoys,
  markCashCollected,
  type DeliveryOrder,
} from '@/api/deliveries';
import { setOrderStatus } from '@/api/orders';
import { listStores } from '@/api/stores';
import type { OrderStatus } from '@/types';

function fulfilmentBadge(row: DeliveryOrder) {
  return (
    <Badge tone={row.fulfillmentType === 'home_delivery' ? 'blue' : 'gray'}>
      {titleCase(row.fulfillmentType || '—')}
    </Badge>
  );
}

function paymentBadge(row: DeliveryOrder) {
  return (
    <Badge tone={row.paymentStatus === 'paid' ? 'green' : 'amber'}>
      {titleCase(row.paymentStatus || '—')}
    </Badge>
  );
}

/** A quick glance at what's in the parcel, without opening the row's detail. */
function itemsSummary(row: DeliveryOrder) {
  if (row.items.length === 0) {
    return <span className="text-slate-400">{row.itemCount || 0} item(s)</span>;
  }
  const text = row.items.map((it) => `${it.name} ×${it.qty}`).join(', ');
  return (
    <p className="max-w-[220px] truncate text-slate-600" title={text}>
      {text}
    </p>
  );
}

/** The order code cell — click it to open the full delivery detail (member,
 * address and items) rather than making the whole row clickable, which would
 * fight with the action buttons/selects the other cells already carry. */
function codeCell(row: DeliveryOrder, onOpen: (row: DeliveryOrder) => void) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="text-left hover:underline"
    >
      <p className="font-medium text-brand-600">{row.code}</p>
      <p className="text-xs text-slate-400">{formatDateTime(row.placedAt)}</p>
    </button>
  );
}

/**
 * The DELIVERY role's own portal — "what's ready to pick up" and "what I'm
 * carrying" — plus a simple store-scoped assignment view for admin,
 * superadmin and pharmacy, who hand cash orders to a delivery boy without
 * needing the delivery boy's own two-queue view.
 */
export default function DeliveriesPage() {
  const { user, accessToken } = useAuth();
  const isDeliveryBoy = user?.role === 'delivery';
  const isPharmacy = user?.role === 'pharmacy';
  const needsStorePicker = user?.role === 'admin' || user?.role === 'superadmin';

  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DeliveryOrder | null>(null);

  async function runAction(
    id: string,
    action: () => Promise<void>,
    ...reloads: Array<() => void>
  ) {
    setActionError(null);
    setActingId(id);
    try {
      await action();
      reloads.forEach((reload) => reload());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That action failed.');
    } finally {
      setActingId(null);
    }
  }

  // --- Delivery boy's own queues --------------------------------------
  const available = useAsync(
    () =>
      isDeliveryBoy && user?.storeCode
        ? listAvailableForDelivery(user.storeCode)
        : Promise.resolve([]),
    [isDeliveryBoy, user?.storeCode],
  );
  const mine = useAsync(
    () => (isDeliveryBoy && user?.id ? listAssignedToMe(user.id) : Promise.resolve([])),
    [isDeliveryBoy, user?.id],
  );

  // --- Everyone else's simple store-scoped assignment view -------------
  const stores = useAsync(
    () => (needsStorePicker ? listStores(accessToken) : Promise.resolve([])),
    [needsStorePicker, accessToken],
  );
  const [selectedStore, setSelectedStore] = useState('');

  useEffect(() => {
    if (needsStorePicker && !selectedStore && stores.data && stores.data.length > 0) {
      setSelectedStore(stores.data[0].code);
    }
  }, [needsStorePicker, selectedStore, stores.data]);

  const scopedStoreCode = isPharmacy ? (user?.storeCode ?? '') : selectedStore;

  const adminAvailable = useAsync(
    () =>
      !isDeliveryBoy && scopedStoreCode
        ? listAvailableForDelivery(scopedStoreCode)
        : Promise.resolve([]),
    [isDeliveryBoy, scopedStoreCode],
  );
  const deliveryBoys = useAsync(
    () =>
      !isDeliveryBoy && scopedStoreCode
        ? listDeliveryBoys(scopedStoreCode)
        : Promise.resolve([]),
    [isDeliveryBoy, scopedStoreCode],
  );

  const storeOptions = useMemo(
    () => (stores.data ?? []).map((s) => ({ value: s.code, label: s.name })),
    [stores.data],
  );

  async function assignToMe(orderId: string) {
    if (!user) return;
    await runAction(
      orderId,
      () => assignDeliveryBoy(orderId, user.id),
      available.reload,
      mine.reload,
    );
  }

  async function collectCash(orderId: string) {
    await runAction(orderId, () => markCashCollected(orderId), mine.reload);
  }

  async function advanceStatus(orderId: string, next: OrderStatus) {
    await runAction(orderId, () => setOrderStatus(orderId, next), mine.reload, available.reload);
  }

  async function assignFromDropdown(orderId: string, deliveryBoyId: string) {
    await runAction(orderId, () => assignDeliveryBoy(orderId, deliveryBoyId), adminAvailable.reload);
  }

  const availableColumns: Column<DeliveryOrder>[] = [
    {
      key: 'code',
      header: 'Order',
      render: (row) => codeCell(row, setSelected),
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
    { key: 'items', header: 'Items', render: itemsSummary },
    { key: 'fulfilment', header: 'Fulfilment', render: fulfilmentBadge },
    { key: 'payment', header: 'Payment', render: paymentBadge },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => formatCurrency(row.mrpTotal),
      className: 'text-right',
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button
          size="sm"
          variant="secondary"
          disabled={actingId === row.id}
          onClick={() => void assignToMe(row.id)}
        >
          Assign to me
        </Button>
      ),
      className: 'text-right',
    },
  ];

  const mineColumns: Column<DeliveryOrder>[] = [
    {
      key: 'code',
      header: 'Order',
      render: (row) => codeCell(row, setSelected),
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
    { key: 'items', header: 'Items', render: itemsSummary },
    { key: 'fulfilment', header: 'Fulfilment', render: fulfilmentBadge },
    { key: 'payment', header: 'Payment', render: paymentBadge },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => formatCurrency(row.mrpTotal),
      className: 'text-right',
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          {row.paymentStatus === 'pending' && (
            <Button
              size="sm"
              variant="success"
              disabled={actingId === row.id}
              onClick={() => void collectCash(row.id)}
            >
              Mark cash collected
            </Button>
          )}
          {row.status === 'processing' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={actingId === row.id}
              onClick={() => void advanceStatus(row.id, 'out_for_delivery')}
            >
              Out for delivery
            </Button>
          )}
          {row.status === 'out_for_delivery' && (
            <Button
              size="sm"
              variant="primary"
              disabled={actingId === row.id}
              onClick={() => void advanceStatus(row.id, 'delivered')}
            >
              Delivered
            </Button>
          )}
        </div>
      ),
      className: 'text-right',
    },
  ];

  const adminColumns: Column<DeliveryOrder>[] = [
    {
      key: 'code',
      header: 'Order',
      render: (row) => codeCell(row, setSelected),
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
    { key: 'items', header: 'Items', render: itemsSummary },
    { key: 'fulfilment', header: 'Fulfilment', render: fulfilmentBadge },
    { key: 'payment', header: 'Payment', render: paymentBadge },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => formatCurrency(row.mrpTotal),
      className: 'text-right',
    },
    {
      key: 'assign',
      header: 'Assign',
      render: (row) => (
        <select
          value=""
          disabled={actingId === row.id || (deliveryBoys.data ?? []).length === 0}
          onChange={(e) => {
            const id = e.target.value;
            if (id) void assignFromDropdown(row.id, id);
          }}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        >
          <option value="">
            {(deliveryBoys.data ?? []).length === 0 ? 'No delivery boys' : 'Assign to…'}
          </option>
          {(deliveryBoys.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ),
      className: 'text-right',
    },
  ];

  const detailModal = (
    <Modal
      open={Boolean(selected)}
      onClose={() => setSelected(null)}
      title={selected ? selected.code : ''}
    >
      {selected && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {fulfilmentBadge(selected)}
            {paymentBadge(selected)}
          </div>
          <DetailList
            rows={[
              { label: 'Member', value: selected.memberName },
              { label: 'Phone', value: selected.memberPhone },
              { label: 'Deliver to', value: selected.address || '—' },
              { label: 'Branch', value: selected.storeName || '—' },
              { label: 'Amount', value: formatCurrency(selected.mrpTotal) },
              { label: 'Placed', value: formatDateTime(selected.placedAt) },
            ]}
          />
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Items
            </p>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {selected.items.length === 0 ? (
                    <tr>
                      <td className="px-3 py-2 text-slate-400">No line items recorded.</td>
                    </tr>
                  ) : (
                    selected.items.map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <p className="text-slate-800">{item.name}</p>
                          <p className="text-xs text-slate-400">{item.pack}</p>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">×{item.qty}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Modal>
  );

  if (isDeliveryBoy) {
    return (
      <>
        <PageHeader
          title="Deliveries"
          subtitle="Home deliveries open for pickup at your branch, and what you're carrying now."
        />

        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Available to deliver"
            value={available.data?.length ?? 0}
            icon="deliveries"
            tone="blue"
          />
          <StatCard
            label="My deliveries"
            value={mine.data?.length ?? 0}
            icon="orders"
            tone="amber"
          />
        </div>

        {!user?.storeCode ? (
          <Card>
            <div className="p-6 text-sm text-slate-500">
              Your account isn't linked to a branch yet — ask a Super Admin to set one
              before orders can be picked up.
            </div>
          </Card>
        ) : (
          <>
            <Card className="mb-6">
              <CardHeader
                title="Available to deliver"
                subtitle="Unclaimed home-delivery orders at your branch — cash still to collect, or already wallet-paid"
              />
              <DataTable
                columns={availableColumns}
                rows={available.data ?? []}
                loading={available.loading}
                error={available.error}
                empty="Nothing waiting for pickup right now."
              />
            </Card>

            <Card>
              <CardHeader title="My deliveries" subtitle="Orders you've claimed" />
              <DataTable
                columns={mineColumns}
                rows={mine.data ?? []}
                loading={mine.loading}
                error={mine.error}
                empty="You haven't claimed any orders yet."
              />
              {actionError && (
                <p className="border-t border-slate-200 px-4 py-2 text-xs text-rose-600">
                  {actionError}
                </p>
              )}
            </Card>
          </>
        )}
        {detailModal}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Deliveries"
        subtitle="Hand a branch's unclaimed home deliveries to a delivery boy."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Unclaimed home deliveries"
          value={adminAvailable.data?.length ?? 0}
          icon="deliveries"
          tone="blue"
        />
        <StatCard
          label="Delivery boys at branch"
          value={deliveryBoys.data?.length ?? 0}
          icon="users"
          tone="violet"
        />
      </div>

      <Card>
        <CardHeader
          title="Unclaimed home deliveries"
          subtitle={
            isPharmacy && !user?.storeCode
              ? "Your account isn't linked to a branch yet."
              : 'Cash still to collect, or already wallet-paid — every home delivery waiting on a delivery boy'
          }
          action={
            needsStorePicker ? (
              <FilterSelect
                value={selectedStore}
                onChange={setSelectedStore}
                options={
                  storeOptions.length > 0
                    ? storeOptions
                    : [{ value: '', label: 'No branches' }]
                }
              />
            ) : undefined
          }
        />
        <DataTable
          columns={adminColumns}
          rows={adminAvailable.data ?? []}
          loading={adminAvailable.loading}
          error={adminAvailable.error}
          empty="No unclaimed home deliveries at this branch."
        />
        {actionError && (
          <p className="border-t border-slate-200 px-4 py-2 text-xs text-rose-600">
            {actionError}
          </p>
        )}
      </Card>
      {detailModal}
    </>
  );
}
