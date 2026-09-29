import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listMemberTransactions, moneyFlowKindLabel, moneyFlowKindTone } from '@/api/accounts';
import { buildLedger, type LedgerRow } from '@/lib/ledger';
import type { MemberMoneyFlowSummary } from '@/types';

const COLUMNS: Column<LedgerRow>[] = [
  { key: 'when', header: 'Date', render: (row) => formatDateTime(row.occurredAt) },
  {
    key: 'particulars',
    header: 'Particulars',
    render: (row) => (
      <div>
        <div className="flex items-center gap-1.5">
          <Badge tone={moneyFlowKindTone(row.kind)}>{moneyFlowKindLabel(row.kind)}</Badge>
          <span className="text-slate-800">{row.label}</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">{row.detail}</p>
      </div>
    ),
  },
  {
    key: 'debit',
    header: 'Debit',
    render: (row) =>
      row.direction === 'out' ? (
        <span className="font-semibold text-rose-600">{formatCurrency(row.amount)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
    className: 'text-right',
  },
  {
    key: 'credit',
    header: 'Credit',
    render: (row) =>
      row.direction === 'in' ? (
        <span className="font-semibold text-emerald-600">{formatCurrency(row.amount)}</span>
      ) : (
        <span className="text-slate-300">—</span>
      ),
    className: 'text-right',
  },
  {
    key: 'balance',
    header: 'Balance',
    render: (row) => (
      <span className="font-semibold text-slate-900">{formatCurrency(row.balance)}</span>
    ),
    className: 'text-right',
  },
];

/** The report document itself — rendered twice: once inside the modal for
 *  on-screen preview, once into a portal at the body root that only shows
 *  up under `@media print` (see `.ledger-print-root` in index.css), the
 *  same split {@link InvoiceModal} uses for invoices. Kept as its own
 *  component so both copies can never drift apart. */
function LedgerDocument({
  member,
  rows,
  totalIn,
  totalOut,
  generatedAt,
}: {
  member: MemberMoneyFlowSummary;
  rows: LedgerRow[];
  totalIn: number;
  totalOut: number;
  generatedAt: string;
}) {
  const closingBalance = rows[0]?.balance ?? 0;
  return (
    <article className="ledger-document bg-white text-slate-800">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-bold">Sahakar 360</h2>
          <p className="text-sm text-slate-500">Member ledger report</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Generated {formatDateTime(generatedAt)}</p>
        </div>
      </header>
      <div className="my-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs uppercase text-slate-500">Member</p>
          <p className="font-semibold">{member.name}</p>
          <p>{member.phone}</p>
          {member.email && <p className="text-xs text-slate-500">{member.email}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase text-slate-500">Statement period</p>
          <p>
            {rows.length
              ? `${formatDateTime(rows[rows.length - 1].occurredAt)} — ${formatDateTime(rows[0].occurredAt)}`
              : 'No transactions yet'}
          </p>
          <p className="text-xs text-slate-500">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>
        </div>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="p-2 text-left">Date</th>
            <th className="p-2 text-left">Particulars</th>
            <th className="p-2 text-right">Debit</th>
            <th className="p-2 text-right">Credit</th>
            <th className="p-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="p-2 whitespace-nowrap">{formatDateTime(row.occurredAt)}</td>
              <td className="p-2">
                <p>
                  {moneyFlowKindLabel(row.kind)} — {row.label}
                </p>
                <p className="text-xs text-slate-500">{row.detail}</p>
              </td>
              <td className="p-2 text-right whitespace-nowrap">
                {row.direction === 'out' ? formatCurrency(row.amount) : '—'}
              </td>
              <td className="p-2 text-right whitespace-nowrap">
                {row.direction === 'in' ? formatCurrency(row.amount) : '—'}
              </td>
              <td className="p-2 text-right font-medium whitespace-nowrap">
                {formatCurrency(row.balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="py-4 text-sm text-slate-500">This member has no recorded transactions yet.</p>
      )}
      <div className="ledger-totals ml-auto mt-4 max-w-xs space-y-2 text-sm">
        <div className="flex justify-between">
          <span>Total credit</span>
          <span className="font-medium text-emerald-600">{formatCurrency(totalIn)}</span>
        </div>
        <div className="flex justify-between">
          <span>Total debit</span>
          <span className="font-medium text-rose-600">{formatCurrency(totalOut)}</span>
        </div>
        <div className="flex justify-between border-t pt-2 text-lg font-bold">
          <span>Closing balance</span>
          <span>{formatCurrency(closingBalance)}</span>
        </div>
      </div>
      <p className="mt-6 border-t pt-3 text-center text-xs text-slate-500">
        This report reflects settled money movement only — cancelled orders, bookings and
        appointments, and privilege-plan loads still pending approval, are not included.
      </p>
    </article>
  );
}

export function LedgerReportModal({
  member,
  open,
  onClose,
}: {
  member: MemberMoneyFlowSummary | null;
  open: boolean;
  onClose: () => void;
}) {
  const memberId = member?.id ?? '';
  const transactions = useAsync(
    () => (memberId ? listMemberTransactions(memberId, 500) : Promise.resolve([])),
    [memberId],
  );
  const rows = transactions.data ?? [];
  const ledgerRows = useMemo(() => buildLedger(rows), [rows]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          if (row.direction === 'in') acc.in += row.amount;
          else acc.out += row.amount;
          return acc;
        },
        { in: 0, out: 0 },
      ),
    [rows],
  );
  const generatedAt = useMemo(() => new Date().toISOString(), [open, memberId]);

  if (!member) return null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Ledger report — ${member.name}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      >
        {transactions.error && (
          <p role="alert" className="mb-3 text-sm text-rose-600">
            {transactions.error}
          </p>
        )}
        {transactions.loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading ledger…</p>
        ) : (
          <>
            <LedgerDocument
              member={member}
              rows={ledgerRows}
              totalIn={totals.in}
              totalOut={totals.out}
              generatedAt={generatedAt}
            />
            {/* The on-screen document above is a compact statement view; this
                table underneath gives the same rows in the console's usual
                DataTable styling. It never prints — the print stylesheet
                hides everything under the modal except `.ledger-print-root`. */}
            <div className="mt-6">
              <DataTable columns={COLUMNS} rows={ledgerRows} loading={false} empty="No transactions." />
            </div>
          </>
        )}
      </Modal>
      {open &&
        member &&
        !transactions.loading &&
        createPortal(
          <div className="ledger-print-root">
            <LedgerDocument
              member={member}
              rows={ledgerRows}
              totalIn={totals.in}
              totalOut={totals.out}
              generatedAt={generatedAt}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
