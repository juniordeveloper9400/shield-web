import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DetailList } from '@/components/ui/DetailList';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import { fileToResizedDataUrl } from '@/lib/images';
import { formatCurrency, formatDateTime, titleCase, toneForStatus } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { clearOrderBill, listOrders, sendOrderBill, setOrderStatus } from '@/api/orders';
import type { Order, OrderStatus } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'processing', label: 'Processing' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const KIND_OPTIONS = [
  { value: 'all', label: 'All kinds' },
  { value: 'standard', label: 'Standard' },
  { value: 'prescription', label: 'Prescription' },
];

export default function OrdersPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listOrders, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  const [store, setStore] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The invoice this order is sent back to the member with.
  const [billSaving, setBillSaving] = useState(false);
  const [billError, setBillError] = useState<string | null>(null);

  // A receipt or a bill image opened full-size, over the order modal.
  const [viewImage, setViewImage] = useState<{ src: string; title: string } | null>(
    null,
  );

  const scoped = useMemo(() => scopeToStore(rows, user), [rows, user]);
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
      const matchesKind = kind === 'all' || row.kind === kind;
      const matchesStore = store === 'all' || row.storeCode === store;
      return matchesQuery && matchesStatus && matchesKind && matchesStore;
    });
  }, [scoped, search, status, kind, store]);

  async function changeStatus(id: string, next: OrderStatus) {
    setSaving(true);
    try {
      await setOrderStatus(id, next);
      setSelectedId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleBillPick(id: string, file: File) {
    setBillError(null);
    setBillSaving(true);
    try {
      // A bill has to stay legible at whatever size a member zooms it to —
      // wider than the banner/product convention, close to what the
      // Prescriptions intake photo allows.
      const image = await fileToResizedDataUrl(file, 1400, 0.78);
      await sendOrderBill(id, image);
      reload();
    } catch (err) {
      setBillError(err instanceof Error ? err.message : 'Could not send the bill.');
    } finally {
      setBillSaving(false);
    }
  }

  async function removeBill(id: string) {
    setBillError(null);
    setBillSaving(true);
    try {
      await clearOrderBill(id);
      reload();
    } catch (err) {
      setBillError(err instanceof Error ? err.message : 'Could not remove the bill.');
    } finally {
      setBillSaving(false);
    }
  }

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
          <p className="text-xs text-slate-400">
            {titleCase(row.kind)} · {formatDateTime(row.placedAt)}
          </p>
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
            <FilterSelect value={kind} onChange={setKind} options={KIND_OPTIONS} />
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

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected ? selected.code : ''}
        footer={
          selected && (
            <>
              {selected.status === 'processing' && (
                <Button
                  variant="primary"
                  disabled={saving}
                  onClick={() => changeStatus(selected.id, 'out_for_delivery')}
                >
                  Out for delivery
                </Button>
              )}
              {(selected.status === 'processing' ||
                selected.status === 'out_for_delivery') && (
                <Button
                  variant="success"
                  disabled={saving}
                  onClick={() => changeStatus(selected.id, 'delivered')}
                >
                  <Icon name="check" className="h-4 w-4" /> Mark delivered
                </Button>
              )}
              {selected.status !== 'delivered' && selected.status !== 'cancelled' && (
                <Button
                  variant="danger"
                  disabled={saving}
                  onClick={() => changeStatus(selected.id, 'cancelled')}
                >
                  Cancel
                </Button>
              )}
            </>
          )
        }
      >
        {selected && (
          <>
            <div className="mb-3">
              <Badge tone={toneForStatus(selected.status)}>
                {titleCase(selected.status)}
              </Badge>
            </div>
            <DetailList
              rows={[
                { label: 'Member', value: selected.memberName },
                { label: 'Phone', value: selected.memberPhone },
                { label: 'Branch', value: selected.storeName },
                { label: 'Kind', value: titleCase(selected.kind) },
                { label: 'Payment', value: selected.paymentMethod },
                { label: 'MRP total', value: formatCurrency(selected.mrpTotal) },
                { label: 'Delivery fee', value: formatCurrency(selected.deliveryFee) },
                { label: 'Paid', value: formatCurrency(selected.paidTotal) },
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
                    {selected.lines.length === 0 ? (
                      <tr>
                        <td className="px-3 py-2 text-slate-400">
                          No line items recorded.
                        </td>
                      </tr>
                    ) : (
                      selected.lines.map((line, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">
                            <p className="text-slate-800">{line.name}</p>
                            <p className="text-xs text-slate-400">{line.pack}</p>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">
                            ×{line.qty}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-800">
                            {formatCurrency(line.unitPrice * line.qty)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payment receipt
              </p>
              {!selected.receipt ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400">
                  No receipt uploaded with this order.
                </p>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  {selected.receipt.image ? (
                    <button
                      type="button"
                      onClick={() =>
                        setViewImage({
                          src: selected.receipt!.image,
                          title: `${selected.code} — receipt`,
                        })
                      }
                      className="h-20 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                    >
                      <img
                        src={selected.receipt.image}
                        alt="Payment receipt"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-400">
                      No photo
                    </div>
                  )}
                  <div className="min-w-0 text-sm">
                    <p className="text-slate-800">
                      {selected.receipt.payerName || 'Unnamed payer'}
                    </p>
                    <p className="text-xs text-slate-500">
                      Ref {selected.receipt.reference || '—'} ·{' '}
                      {formatCurrency(selected.receipt.amount)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDateTime(selected.receipt.uploadedAt)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Invoice sent to the member
              </p>
              {selected.billImage ? (
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <button
                    type="button"
                    onClick={() =>
                      setViewImage({
                        src: selected.billImage,
                        title: `${selected.code} — invoice`,
                      })
                    }
                    className="h-20 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                  >
                    <img
                      src={selected.billImage}
                      alt="Invoice sent to the member"
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <div className="min-w-0 text-sm">
                    <p className="text-slate-800">
                      Sent {selected.billedAt ? formatDateTime(selected.billedAt) : ''}
                    </p>
                    <p className="mt-1 flex items-center gap-2">
                      <label className="cursor-pointer text-xs font-medium text-brand-600">
                        Replace
                        <input
                          type="file"
                          accept="image/*"
                          disabled={billSaving}
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleBillPick(selected.id, file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={billSaving}
                        className="text-xs font-medium text-rose-600 disabled:opacity-50"
                        onClick={() => removeBill(selected.id)}
                      >
                        Remove
                      </button>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={billSaving}
                    className="text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-brand-50 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-brand-700"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleBillPick(selected.id, file);
                      e.target.value = '';
                    }}
                  />
                  {billSaving && (
                    <span className="text-xs text-slate-400">Sending…</span>
                  )}
                </div>
              )}
              {billError && (
                <p className="mt-2 text-xs text-rose-600">{billError}</p>
              )}
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(viewImage)}
        onClose={() => setViewImage(null)}
        title={viewImage?.title ?? ''}
      >
        {viewImage && (
          <img
            src={viewImage.src}
            alt={viewImage.title}
            className="max-h-[70vh] w-full object-contain"
          />
        )}
      </Modal>
    </>
  );
}
