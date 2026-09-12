import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { fileToResizedDataUrl } from '@/lib/images';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { clearOrderBill, listOrders, sendOrderBill } from '@/api/orders';
import type { Order } from '@/types';

const BILL_OPTIONS = [
  { value: 'all', label: 'All orders' },
  { value: 'sent', label: 'Bill sent' },
  { value: 'pending', label: 'Not sent yet' },
];

/**
 * The store's invoice for every order, in one place — the same "Invoice
 * sent to the member" upload that lives inside Orders → Manage, pulled out
 * to its own directory (like Stores) so an admin can see what's been billed
 * across every branch without opening one order at a time.
 */
export default function BillsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listOrders, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [store, setStore] = useState('all');
  const [billFilter, setBillFilter] = useState('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(
    null,
  );
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q);
      const matchesStore = store === 'all' || row.storeCode === store;
      const matchesBill =
        billFilter === 'all' ||
        (billFilter === 'sent' ? Boolean(row.billImage) : !row.billImage);
      return matchesQuery && matchesStore && matchesBill;
    });
  }, [scoped, search, store, billFilter]);

  const sentCount = scoped.filter((r) => r.billImage).length;
  const pendingCount = scoped.length - sentCount;

  async function handlePick(id: string, file: File) {
    setRowError(null);
    setSavingId(id);
    try {
      // Same size budget as the Orders modal's own upload — legible at
      // whatever zoom a member reads it back at.
      const image = await fileToResizedDataUrl(file, 1400, 0.78);
      await sendOrderBill(id, image);
      reload();
    } catch (err) {
      setRowError({
        id,
        message: err instanceof Error ? err.message : 'Could not send the bill.',
      });
    } finally {
      setSavingId(null);
    }
  }

  async function remove(id: string) {
    setRowError(null);
    setSavingId(id);
    try {
      await clearOrderBill(id);
      reload();
    } catch (err) {
      setRowError({
        id,
        message: err instanceof Error ? err.message : 'Could not remove the bill.',
      });
    } finally {
      setSavingId(null);
    }
  }

  const columns: Column<Order>[] = [
    {
      key: 'code',
      header: 'Order',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.code}</p>
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
      key: 'paid',
      header: 'Paid',
      render: (row) => formatCurrency(row.paidTotal),
      className: 'text-right',
    },
    {
      key: 'bill',
      header: 'Bill',
      render: (row) =>
        row.billImage ? (
          <button
            type="button"
            onClick={() =>
              setViewImage({ src: row.billImage, title: `${row.code} — invoice` })
            }
            className="h-14 w-11 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
          >
            <img
              src={row.billImage}
              alt="Invoice sent to the member"
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <Badge tone="amber">Not sent</Badge>
        ),
    },
    {
      key: 'sent',
      header: 'Sent',
      render: (row) => (row.billedAt ? formatDateTime(row.billedAt) : '—'),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex items-center justify-end gap-3">
          <label className="cursor-pointer text-xs font-medium text-brand-600">
            {row.billImage ? 'Replace' : 'Send bill'}
            <input
              type="file"
              accept="image/*"
              disabled={savingId === row.id}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handlePick(row.id, file);
                e.target.value = '';
              }}
            />
          </label>
          {row.billImage && (
            <button
              type="button"
              disabled={savingId === row.id}
              className="text-xs font-medium text-rose-600 disabled:opacity-50"
              onClick={() => remove(row.id)}
            >
              Remove
            </button>
          )}
        </div>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Bills"
        subtitle={
          branchBound
            ? "Invoices sent back to members for your branch's orders."
            : 'Invoices sent back to members, across every branch.'
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total orders" value={scoped.length} icon="orders" tone="blue" />
        <StatCard label="Bill sent" value={sentCount} icon="check" tone="green" />
        <StatCard
          label="Not sent yet"
          value={pendingCount}
          icon="alert"
          tone="amber"
        />
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
            <FilterSelect
              value={billFilter}
              onChange={setBillFilter}
              options={BILL_OPTIONS}
            />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No orders match your filters."
        />
        {rowError && (
          <p className="border-t border-slate-200 px-4 py-2 text-xs text-rose-600">
            {rowError.message}
          </p>
        )}
      </Card>

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
