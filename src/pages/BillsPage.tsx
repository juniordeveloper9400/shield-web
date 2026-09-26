import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { scopeToStore } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatDateTime, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { clearOrderBill, listOrders } from '@/api/orders';
import { BillEditorModal } from '@/components/orders/BillEditorModal';
import type { Order } from '@/types';

const BILL_OPTIONS = [
  { value: 'all', label: 'All bills' },
  { value: 'sent', label: 'Bill sent' },
  { value: 'pending', label: 'Not sent yet' },
];

/**
 * The store's invoice for every order that has been converted to a bill, in
 * one place. An order gets here only through "Convert to bill →" on the Orders
 * (or Prescriptions) review modal — pricing, sending the invoice and the
 * OTP-gated payment collection all happen from this page.
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
  const [editing, setEditing] = useState<Order | null>(null);

  // Set the moment "Convert to bill →" lands here and finds its order —
  // the banner that confirms the hand-off actually worked, since the
  // prescription modal itself closed silently on the way over here. Cleared
  // once the admin dismisses it or the bill editor it points at is closed,
  // so it never lingers past the OTP flow it was announcing.
  const [justConverted, setJustConverted] = useState<{
    id: string;
    code: string;
  } | null>(null);

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
      setJustConverted({ id: match.id, code: match.code });
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

  // An order only appears here once it's been reviewed on the Orders page and
  // converted ("Convert to bill →"). A freshly-received order stays on Orders.
  const scoped = useMemo(
    () =>
      scopeToStore(
        rows.filter((o) => o.convertedToBillAt),
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
      key: 'fulfilment',
      header: 'Fulfilment',
      render: (row) => (
        <Badge tone="gray">{titleCase(row.fulfillmentType)}</Badge>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">
          {formatDateTime(row.placedAt)}
        </span>
      ),
    },
    {
      // One glance instead of three separate columns (Bill / Payment status
      // / Sent) — the same "where is this in its own lifecycle" question
      // the three stat cards above answer, just per row: not sent yet
      // (no bill priced/sent), sent but not collected, or paid. The bill
      // amount, its own invoice image and the exact sent date are still on
      // "Manage bill" — this is the at-a-glance version, not the only place
      // to find them.
      key: 'status',
      header: 'Status',
      render: (row) =>
        row.billAmount <= 0 ? (
          <Badge tone="amber">Not sent</Badge>
        ) : row.billStatus === 'paid' ? (
          <Badge tone="green">Paid</Badge>
        ) : (
          <Badge tone="amber">Sent · Pending</Badge>
        ),
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
            ? "Orders converted to bills for your branch — price, send and collect payment here."
            : 'Orders converted to bills, across every branch — price, send and collect payment here.'
        }
      />

      {justConverted && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>
            <strong>{justConverted.code}</strong> converted to a bill —
            price it below, then collect payment via OTP to finish.
          </span>
          <button
            type="button"
            onClick={() => setJustConverted(null)}
            className="shrink-0 text-emerald-600 hover:text-emerald-800"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Converted to bill" value={scoped.length} icon="orders" tone="blue" />
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
          empty={
            scoped.length === 0
              ? 'No orders have been converted to a bill yet. Review an order on the Orders page and choose "Convert to bill".'
              : 'No bills match your filters.'
          }
          onRowClick={setEditing}
        />
        {rowError && (
          <p className="border-t border-slate-200 px-4 py-2 text-xs text-rose-600">
            {rowError.message}
          </p>
        )}
      </Card>

      {editing && (
        <BillEditorModal
          order={editing}
          open={Boolean(editing)}
          onClose={() => {
            setEditing(null);
            if (justConverted?.id === editing.id) setJustConverted(null);
          }}
          onSaved={reload}
        />
      )}
    </>
  );
}
