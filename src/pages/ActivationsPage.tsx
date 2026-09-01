import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { canReviewActivations, scopeToStore } from '@/config/permissions';
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
import { formatCurrency, formatDateTime, titleCase, toneForStatus } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  approveActivation,
  listActivations,
  rejectActivation,
} from '@/api/activations';
import type { PrivilegeActivation } from '@/types';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export default function ActivationsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listActivations, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [store, setStore] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const scoped = useMemo(() => scopeToStore(rows, user), [rows, user]);
  const branchBound = user?.role === 'pharmacy' && Boolean(user.storeCode);
  const canReview = user ? canReviewActivations(user.role) : false;

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of scoped) if (a.storeCode) seen.set(a.storeCode, a.storeName);
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
        row.memberName.toLowerCase().includes(q) ||
        row.memberPhone.includes(q) ||
        row.tier.toLowerCase().includes(q) ||
        row.cardNumber.toLowerCase().includes(q);
      const matchesStatus = status === 'all' || row.status === status;
      const matchesStore = store === 'all' || row.storeCode === store;
      return matchesQuery && matchesStatus && matchesStore;
    });
  }, [scoped, search, status, store]);

  const counts = {
    pending: scoped.filter((r) => r.status === 'pending').length,
    approved: scoped.filter((r) => r.status === 'approved').length,
    rejected: scoped.filter((r) => r.status === 'rejected').length,
  };
  const pendingValue = scoped
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + r.amount, 0);

  function closeModal() {
    setSelectedId(null);
    setRejecting(false);
    setNote('');
    setActionError(null);
  }

  async function approve(id: string) {
    if (!canReview) {
      setActionError('Only a Super Admin can approve activations.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const ok = await approveActivation(id);
      if (!ok) {
        setActionError('This activation is no longer pending — reloading.');
      }
      closeModal();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setSaving(false);
    }
  }

  async function reject(id: string) {
    if (!canReview) {
      setActionError('Only a Super Admin can reject activations.');
      return;
    }
    if (!note.trim()) {
      setActionError('Give the member a reason for the rejection.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await rejectActivation(id, note);
      closeModal();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not reject.');
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<PrivilegeActivation>[] = [
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
    {
      key: 'plan',
      header: 'Plan',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.tier}</p>
          <p className="text-xs text-slate-400">
            {row.cardNumber || '—'} · {formatDateTime(row.submittedAt)}
          </p>
        </div>
      ),
    },
    ...(branchBound
      ? []
      : [
          {
            key: 'branch',
            header: 'Branch',
            render: (row: PrivilegeActivation) => row.storeName,
          } as Column<PrivilegeActivation>,
        ]),
    {
      key: 'load',
      header: 'Load',
      render: (row) => formatCurrency(row.amount),
      className: 'text-right',
    },
    {
      key: 'credited',
      header: 'Credits',
      render: (row) => formatCurrency(row.credited),
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
        <Button variant="secondary" size="sm" onClick={() => setSelectedId(row.id)}>
          {row.status === 'pending' && canReview ? 'Review' : 'Open'}
        </Button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Activations"
        subtitle={
          branchBound
            ? 'Privilege plans submitted at your branch, awaiting approval.'
            : 'Privilege plans members submitted, awaiting approval.'
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending" value={counts.pending} icon="alert" tone="amber" />
        <StatCard
          label="Pending value"
          value={formatCurrency(pendingValue)}
          tone="blue"
        />
        <StatCard label="Approved" value={counts.approved} icon="check" tone="green" />
        <StatCard label="Rejected" value={counts.rejected} tone="rose" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search member, phone, plan, card…"
          />
          <div className="flex flex-wrap gap-2">
            {!branchBound && (
              <FilterSelect value={store} onChange={setStore} options={storeOptions} />
            )}
            <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No activations match your filters."
        />
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={closeModal}
        title={selected ? `${selected.tier} · ${selected.memberName}` : ''}
        footer={
          selected && selected.status === 'pending' && canReview ? (
            rejecting ? (
              <>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setRejecting(false);
                    setActionError(null);
                  }}
                >
                  Back
                </Button>
                <Button
                  variant="danger"
                  disabled={saving}
                  onClick={() => reject(selected.id)}
                >
                  Confirm rejection
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="danger"
                  disabled={saving}
                  onClick={() => setRejecting(true)}
                >
                  Reject
                </Button>
                <Button
                  variant="success"
                  disabled={saving}
                  onClick={() => approve(selected.id)}
                >
                  <Icon name="check" className="h-4 w-4" /> Approve &amp; credit
                </Button>
              </>
            )
          ) : null
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
                { label: 'Plan', value: selected.tier },
                { label: 'Branch', value: selected.storeName },
                { label: 'Card number', value: selected.cardNumber || '—' },
                { label: 'Load', value: formatCurrency(selected.amount) },
                { label: 'Bonus (10%)', value: formatCurrency(selected.bonus) },
                {
                  label: 'Credits on approval',
                  value: formatCurrency(selected.credited),
                },
                {
                  label: 'Receipt ref',
                  value: selected.receiptReference || '—',
                },
                {
                  label: 'Receipt file',
                  value: selected.receiptFileName || '—',
                },
                { label: 'Submitted', value: formatDateTime(selected.submittedAt) },
                ...(selected.reviewedAt
                  ? [{ label: 'Reviewed', value: formatDateTime(selected.reviewedAt) }]
                  : []),
                ...(selected.reviewerNote
                  ? [{ label: 'Reason', value: selected.reviewerNote }]
                  : []),
              ]}
            />

            {rejecting && (
              <div className="mt-4">
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Reason for rejection
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="The member sees this in their wallet, e.g. 'Receipt amount does not match the plan.'"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            )}

            {actionError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            {selected.status === 'pending' && !rejecting && canReview && (
              <p className="mt-4 text-xs text-slate-400">
                Approving writes the activation and bonus to the member's wallet
                ledger and adds {formatCurrency(selected.credited)} to their
                balance.
              </p>
            )}

            {selected.status === 'pending' && !canReview && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This activation is awaiting review. Only a Super Admin can
                  approve or reject it.
                </span>
              </p>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
