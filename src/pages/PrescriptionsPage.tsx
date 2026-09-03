import { useEffect, useMemo, useState } from 'react';
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
import { formatDateTime, toneForStatus } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  listPrescriptions,
  savePrescriptionIntake,
  setPrescriptionStatus,
} from '@/api/prescriptions';
import type {
  Prescription,
  PrescriptionMedicineInput,
  PrescriptionStatus,
} from '@/types';

const inputClass =
  'w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

const EMPTY_ROW: PrescriptionMedicineInput = {
  name: '',
  pack: '',
  intake: '',
  totalUnits: 0,
};

const STATUS_LABEL: Record<PrescriptionStatus, string> = {
  awaiting_review: 'Awaiting review',
  read: 'Read',
  in_cart: 'In cart',
  ordered: 'Ordered',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'awaiting_review', label: 'Awaiting review' },
  { value: 'read', label: 'Read' },
  { value: 'in_cart', label: 'In cart' },
  { value: 'ordered', label: 'Ordered' },
];

export default function PrescriptionsPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listPrescriptions, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [store, setStore] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);

  // The intake card the pharmacist is building for the open prescription.
  const [draft, setDraft] = useState<PrescriptionMedicineInput[]>([]);
  const [sending, setSending] = useState(false);

  const scoped = useMemo(() => scopeToStore(rows, user), [rows, user]);
  const branchBound = user?.role === 'pharmacy' && Boolean(user.storeCode);

  const storeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of scoped) if (p.storeCode) seen.set(p.storeCode, p.storeName);
    return [
      { value: 'all', label: 'All branches' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [scoped]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // Load the open prescription's existing lines into the editor (or one blank
  // row to start from).
  useEffect(() => {
    if (!selected) {
      setDraft([]);
      setImageOpen(false);
      return;
    }
    setDraft(
      selected.medicines.length > 0
        ? selected.medicines.map((m) => ({
            name: m.name,
            pack: m.pack,
            intake: `${m.doseMorning}${m.doseAfternoon}${m.doseNight}`,
            totalUnits: m.totalUnits,
          }))
        : [{ ...EMPTY_ROW }],
    );
    // Only when the selected prescription changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function patchRow(i: number, patch: Partial<PrescriptionMedicineInput>) {
    setDraft((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  async function sendIntake() {
    if (!selected) return;
    setSending(true);
    try {
      await savePrescriptionIntake(selected.id, draft);
      setSelectedId(null);
      reload();
    } finally {
      setSending(false);
    }
  }

  const draftHasRows = draft.some((r) => r.name.trim().length > 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((row) => {
      const matchesQuery =
        !q ||
        row.code.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.patientName.toLowerCase().includes(q) ||
        row.doctor.toLowerCase().includes(q);
      const matchesStatus = status === 'all' || row.status === status;
      const matchesStore = store === 'all' || row.storeCode === store;
      return matchesQuery && matchesStatus && matchesStore;
    });
  }, [scoped, search, status, store]);

  async function changeStatus(id: string, next: PrescriptionStatus) {
    setSaving(true);
    try {
      await setPrescriptionStatus(id, next);
      setSelectedId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  const counts = {
    awaiting: scoped.filter((r) => r.status === 'awaiting_review').length,
    read: scoped.filter((r) => r.status === 'read').length,
    inCart: scoped.filter((r) => r.status === 'in_cart').length,
    ordered: scoped.filter((r) => r.status === 'ordered').length,
  };

  const columns: Column<Prescription>[] = [
    {
      key: 'code',
      header: 'Prescription',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.code}</p>
          <p className="text-xs text-slate-400">{row.fileName}</p>
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
    { key: 'patient', header: 'Patient', render: (row) => row.patientName },
    { key: 'doctor', header: 'Doctor', render: (row) => row.doctor || '—' },
    ...(branchBound
      ? []
      : [
          {
            key: 'branch',
            header: 'Branch',
            render: (row: Prescription) => row.storeName,
          } as Column<Prescription>,
        ]),
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={toneForStatus(row.status)}>{STATUS_LABEL[row.status]}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => setSelectedId(row.id)}>
          Open
        </Button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Prescriptions"
        subtitle={
          branchBound
            ? 'Scripts members uploaded for your branch.'
            : 'Scripts members uploaded, across every branch.'
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Awaiting review" value={counts.awaiting} icon="alert" tone="amber" />
        <StatCard label="Read" value={counts.read} icon="prescriptions" tone="blue" />
        <StatCard label="In cart" value={counts.inCart} icon="orders" tone="violet" />
        <StatCard label="Ordered" value={counts.ordered} icon="check" tone="green" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search code, member, patient, doctor…"
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
          empty="No prescriptions match your filters."
        />
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected ? selected.code : ''}
        footer={
          selected && (
            <>
              {selected.status !== 'awaiting_review' && (
                <Button
                  variant="secondary"
                  disabled={saving || sending}
                  onClick={() => changeStatus(selected.id, 'awaiting_review')}
                >
                  Back to awaiting
                </Button>
              )}
              <Button
                variant="primary"
                disabled={sending || !draftHasRows}
                onClick={sendIntake}
              >
                {sending
                  ? 'Sending…'
                  : selected && selected.medicines.length > 0
                    ? 'Update intake card'
                    : 'Send intake card'}
              </Button>
            </>
          )
        }
      >
        {selected && (
          <>
            <div className="mb-3">
              <Badge tone={toneForStatus(selected.status)}>
                {STATUS_LABEL[selected.status]}
              </Badge>
            </div>

            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Uploaded script
              </p>
              {selected.image ? (
                <button
                  type="button"
                  onClick={() => setImageOpen(true)}
                  className="block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                >
                  <img
                    src={selected.image}
                    alt={`Prescription ${selected.code}`}
                    className="max-h-72 w-full object-contain"
                  />
                </button>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-400">
                  No image was uploaded with this prescription.
                </div>
              )}
            </div>

            <DetailList
              rows={[
                { label: 'Member', value: selected.memberName },
                { label: 'Phone', value: selected.memberPhone },
                { label: 'Patient', value: selected.patientName },
                { label: 'Doctor', value: selected.doctor || '—' },
                { label: 'Branch', value: selected.storeName },
                { label: 'Duration', value: selected.duration },
                { label: 'Uploaded', value: formatDateTime(selected.createdAt) },
              ]}
            />

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Intake card
                </p>
                <button
                  type="button"
                  className="text-xs font-medium text-brand-600"
                  onClick={() => setDraft((d) => [...d, { ...EMPTY_ROW }])}
                >
                  + Add medicine
                </button>
              </div>
              <p className="mb-2 text-xs text-slate-400">
                Intake is the three-digit morning-afternoon-night code (e.g.
                101). The customer's app expands their card when you send this.
              </p>
              <div className="space-y-2">
                {draft.map((row, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-slate-200 p-2.5"
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-500">
                        Medicine {i + 1}
                      </span>
                      <button
                        type="button"
                        className="text-xs font-medium text-rose-600"
                        onClick={() =>
                          setDraft((d) => d.filter((_, j) => j !== i))
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      value={row.name}
                      onChange={(e) => patchRow(i, { name: e.target.value })}
                      placeholder="Medicine name"
                      className={`${inputClass} mb-1.5`}
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      <input
                        value={row.pack}
                        onChange={(e) => patchRow(i, { pack: e.target.value })}
                        placeholder="Pack"
                        className={inputClass}
                      />
                      <input
                        value={row.intake}
                        onChange={(e) => patchRow(i, { intake: e.target.value })}
                        placeholder="Intake (101)"
                        inputMode="numeric"
                        maxLength={5}
                        className={`${inputClass} text-center tracking-widest`}
                      />
                      <input
                        value={row.totalUnits || ''}
                        onChange={(e) =>
                          patchRow(i, {
                            totalUnits: Number(e.target.value) || 0,
                          })
                        }
                        placeholder="Units"
                        inputMode="numeric"
                        className={`${inputClass} text-right`}
                      />
                    </div>
                  </div>
                ))}
                {draft.length === 0 && (
                  <p className="text-sm text-slate-400">
                    No lines yet — add the medicines from the script above.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        title={selected ? `${selected.code} — script` : ''}
      >
        {selected?.image && (
          <img
            src={selected.image}
            alt={`Prescription ${selected.code}`}
            className="max-h-[70vh] w-full object-contain"
          />
        )}
      </Modal>
    </>
  );
}
