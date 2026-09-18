import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatCurrency, formatDateTime, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { clearOrderBill, listOrders } from '@/api/orders';
import { listStores } from '@/api/stores';
import { BillEditorModal } from '@/components/orders/BillEditorModal';
import { InvoiceModal } from '@/components/orders/InvoiceModal';
import type { Order, Store } from '@/types';

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
  const { data: stores } = useAsync(listStores, []);
  const storesByCode = useMemo(() => {
    const map = new Map<string, Store>();
    for (const s of stores ?? []) map.set(s.code, s);
    return map;
  }, [stores]);

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
  const [editing, setEditing] = useState<Order | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Order | null>(null);

  // "Convert to bill →" on the prescription review modal lands here with
  // `?open=<orderId>` — opens that order's bill editor immediately, once the
  // list has actually loaded, instead of leaving the admin to search for it
  // themselves. Clears the param right after so a later reload doesn't
  // re-trigger it.
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('open');
  useEffect(() => {
    if (!openId || !data) return;
    const match = data.find((o) => o.id === openId);
    if (match) {
      setEditing(match);
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('open');
        return next;
      },
      { replace: true },
    );
    // Only when the param or the list itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, data]);

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
      const hasBill = Boolean(row.billImage) || row.billAmount > 0;
      const matchesBill =
        billFilter === 'all' || (billFilter === 'sent' ? hasBill : !hasBill);
      return matchesQuery && matchesStore && matchesBill;
    });
  }, [scoped, search, store, billFilter]);

  const sentCount = scoped.filter((r) => r.billImage || r.billAmount > 0).length;
  const pendingCount = scoped.length - sentCount;

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
      key: 'fulfilment',
      header: 'Fulfilment',
      render: (row) => (
        <Badge tone="gray">{titleCase(row.fulfillmentType)}</Badge>
      ),
    },
    {
      key: 'paymentStatus',
      header: 'Payment status',
      render: (row) => (
        <Badge tone={row.paymentStatus === 'paid' ? 'green' : 'amber'}>
          {titleCase(row.paymentStatus)}
        </Badge>
      ),
    },
    {
      key: 'bill',
      header: 'Bill',
      render: (row) =>
        row.billAmount > 0 ? (
          <div className="flex items-center gap-2">
            <Badge tone={row.billStatus === 'paid' ? 'green' : 'amber'}>
              {formatCurrency(row.billAmount)} · {titleCase(row.billStatus)}
            </Badge>
            {row.billImage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewImage({ src: row.billImage, title: `${row.code} — invoice` });
                }}
                className="h-9 w-8 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-50"
              >
                <img
                  src={row.billImage}
                  alt="Invoice sent to the member"
                  className="h-full w-full object-cover"
                />
              </button>
            )}
          </div>
        ) : row.billImage ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setViewImage({ src: row.billImage, title: `${row.code} — invoice` });
            }}
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
          <button
            type="button"
            className="text-xs font-medium text-brand-600"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(row);
            }}
          >
            Manage bill
          </button>
          {(row.billImage || row.billAmount > 0) && (
            <button
              type="button"
              disabled={savingId === row.id}
              className="text-xs font-medium text-rose-600 disabled:opacity-50"
              onClick={(e) => {
                e.stopPropagation();
                remove(row.id);
              }}
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
          onRowClick={setViewingInvoice}
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

      {editing && (
        <BillEditorModal
          order={editing}
          open={Boolean(editing)}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}

      {viewingInvoice && (
        <InvoiceModal
          order={viewingInvoice}
          store={storesByCode.get(viewingInvoice.storeCode)}
          open={Boolean(viewingInvoice)}
          onClose={() => setViewingInvoice(null)}
        />
      )}
    </>
  );
}
