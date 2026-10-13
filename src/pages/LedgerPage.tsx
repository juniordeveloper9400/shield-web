import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FilterSelect } from '@/components/ui/Filters';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatCurrency } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { ACCOUNT_EXPLANATIONS, movementBalance, ledgerReportCsv, type StoreLedgerRow } from '@/lib/ledgerReport';
import {
  closeLedgerPeriod,
  getLedgerEntities,
  getLedgerPeriods,
  getTrialBalance,
  type LedgerEntity,
  type TrialBalanceRow,
} from '@/api/ledger';

const ACCOUNT_TYPES = [
  { value: '', label: 'Every account type' },
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'REVENUE', label: 'Revenue' },
  { value: 'EXPENSE', label: 'Expense' },
];

/** The current month, as 'YYYY-MM-01'. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * The double-entry journal underneath the existing per-module money tables
 * (migrations 0074–0077) — one ledger per legal entity (each shop, plus a
 * company-wide Head Office for money that isn't tied to one store: agent
 * commissions, member wallets, reward points, reserves).
 *
 * Every account and every posting rule is provisional until an accountant
 * reviews them — see the "Provisional" badge on an account, and the
 * Suspense account (9000) on the Head Office trial balance, which carries
 * the gap between an activation's cash receipt and the bonus, commissions
 * and reserves it also commits to. That gap is a real, open
 * revenue-recognition question, not a bug in this page.
 */
export default function LedgerPage() {
  const { user, accessToken } = useAuth();
  const canClosePeriods = user?.role === 'superadmin';

  const entities = useAsync(() => getLedgerEntities(accessToken), [accessToken]);
  // null = "All entities" — a real, selectable view, not just a loading
  // placeholder, so this is also the default: every entity's figures
  // combined until a specific one is picked.
  const [entityId, setEntityId] = useState<number | null>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [accountType, setAccountType] = useState('');
  const [showStoreReport, setShowStoreReport] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const balance = useAsync(
    () => getTrialBalance(accessToken, { entityId: entityId ?? undefined, period, type: accountType || undefined }),
    [accessToken, entityId, period, accountType],
  );

  const periods = useAsync(
    () => (entityId === null ? Promise.resolve([]) : getLedgerPeriods(accessToken, entityId)),
    [accessToken, entityId],
  );

  const storeReport = useAsync(async () => {
    if (!showStoreReport) return [] as StoreLedgerRow[];
    const selected = (entities.data ?? []).filter((entity) => entityId === null || entity.id === entityId);
    const reports = await Promise.all(selected.map(async (entity) => {
      const rows = await getTrialBalance(accessToken, { entityId: entity.id, period, type: accountType || undefined });
      return rows.map((row) => ({ ...row, id: `${entity.id}-${row.accountCode}`, entityName: entity.name, entityCode: entity.code }));
    }));
    return reports.flat();
  }, [showStoreReport, entities.data, accessToken, entityId, period, accountType]);

  function downloadStoreReport() {
    const csv = ledgerReportCsv(storeReport.data ?? [], period.slice(0, 7));
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sahakar-store-ledger-${period.slice(0, 7)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const currentPeriodRow = useMemo(
    () => periods.data?.find((p) => p.period.slice(0, 10) === period),
    [periods.data, period],
  );
  const isClosed = Boolean(currentPeriodRow?.closedAt);

  // DataTable keys rows by id; the trial balance has none of its own, so the
  // account code (unique per row) stands in for it.
  const balanceRows = useMemo(
    () => (balance.data ?? []).map((row) => ({ ...row, id: row.accountCode })),
    [balance.data],
  );

  const totals = useMemo(() => {
    const rows = balance.data ?? [];
    return {
      debit: rows.reduce((s, r) => s + r.debit, 0),
      credit: rows.reduce((s, r) => s + r.credit, 0),
    };
  }, [balance.data]);

  async function handleClosePeriod() {
    if (entityId === null) return;
    setClosing(true);
    setCloseError(null);
    try {
      await closeLedgerPeriod(accessToken, entityId, period);
      periods.reload();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Could not close the period.');
    } finally {
      setClosing(false);
    }
  }

  const columns: Column<TrialBalanceRow & { id: string }>[] = [
    {
      key: 'account',
      header: 'Account',
      render: (row) => (
        <div className="flex items-center gap-2">
          <div>
            <p className="font-mono text-xs text-slate-400">{row.accountCode}</p>
            <p className="text-slate-800">{row.accountName}</p>
            {ACCOUNT_EXPLANATIONS[row.accountCode] && <p className="text-xs text-slate-500">({ACCOUNT_EXPLANATIONS[row.accountCode]})</p>}
          </div>
          {row.isProvisional && <Badge tone="amber">Provisional</Badge>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => <span className="text-xs text-slate-500">{row.accountType}</span>,
    },
    {
      key: 'debit',
      header: 'Debit',
      render: (row) => formatCurrency(row.debit),
      className: 'text-right',
    },
    {
      key: 'credit',
      header: 'Credit',
      render: (row) => formatCurrency(row.credit),
      className: 'text-right',
    },
    {
      key: 'net',
      header: 'Net movement (Debit / Credit)',
      render: (row) => {
        const movement = movementBalance(row.debit, row.credit);
        return <span>{formatCurrency(movement.amount)} {movement.side}</span>;
      },
      className: 'text-right font-semibold',
    },
  ];

  // Entity names already carry "(provisional entity)"/"(provisional)" in
  // their own text (migration 0074's backfill) — not appended again here.
  const entityOptions = [
    { value: '', label: 'All stores + Head Office' },
    ...(entities.data ?? []).map((e: LedgerEntity) => ({ value: String(e.id), label: e.name })),
  ];

  return (
    <>
      <PageHeader
        title="Ledger"
        subtitle="Double-entry journal underneath the money tables — one entity per shop, plus Head Office for commissions, wallets and reserves that aren't tied to any one store."
      />

      <Card className="mb-6 p-4 text-sm text-slate-600">
        Figures show movements during the selected month, not current cash in hand or the remaining wallet balance.
        For wallet liability, Debit reduces what is owed and Credit increases it. Revenue is normally recorded as Credit; it is not a loss.
        Provisional means the account rules await accountant review. Head Office holds shared company accounts separately from stores.
      </Card>

      {(entities.error || balance.error) && (
        <Card className="mb-6 border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
          {entities.error ?? balance.error}
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              value={entityId === null ? '' : String(entityId)}
              onChange={(v) => setEntityId(v ? Number(v) : null)}
              options={entityOptions.length > 0 ? entityOptions : [{ value: '', label: 'No entities yet' }]}
            />
            <input
              type="month"
              value={period.slice(0, 7)}
              onChange={(e) => { if (e.target.value) setPeriod(`${e.target.value}-01`); }}
              aria-label="Report month"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <FilterSelect value={accountType} onChange={setAccountType} options={ACCOUNT_TYPES} />
          </div>

          <div className="flex items-center gap-2">
            {isClosed ? (
              <Badge tone="gray">
                Closed by {currentPeriodRow?.closedBy ?? '—'}
              </Badge>
            ) : (
              canClosePeriods && (
                <Button variant="secondary" size="sm" disabled={closing || entityId === null} onClick={handleClosePeriod}>
                  {closing ? 'Closing…' : 'Close this period'}
                </Button>
              )
            )}
          </div>
        </div>

        {closeError && (
          <p className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">{closeError}</p>
        )}

        <CardHeader
          title="Trial balance"
          subtitle="Monthly account movements for the selected store or Head Office. All stores combines their figures."
        />
        {accountType && <p className="px-4 pb-3 text-xs text-slate-500">Only the selected account type is shown, so debit and credit totals may differ. Select every account type for the complete trial balance.</p>}
        <DataTable
          columns={columns}
          rows={balanceRows}
          loading={balance.loading || entities.loading}
          error={balance.error}
          empty="Nothing posted for this selection and month yet."
        />
        {(balance.data?.length ?? 0) > 0 && (
          <div className="flex justify-end gap-6 border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-500">
              Total debit <span className="font-semibold text-slate-800">{formatCurrency(totals.debit)}</span>
            </span>
            <span className="text-slate-500">
              Total credit <span className="font-semibold text-slate-800">{formatCurrency(totals.credit)}</span>
            </span>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Store-wise monthly ledger report" subtitle="Each store and Head Office shown separately. Uses the month, store and account-type filters above." />
        <div className="flex gap-3 p-4">
          <Button variant="secondary" onClick={() => setShowStoreReport(!showStoreReport)}>
            {showStoreReport ? 'Hide report' : 'Show store-wise report'}
          </Button>
          {showStoreReport && <Button variant="secondary" onClick={downloadStoreReport} disabled={storeReport.loading || entities.loading || Boolean(storeReport.error || entities.error) || !storeReport.data?.length}>Download CSV</Button>}
        </div>
        {showStoreReport && <DataTable<StoreLedgerRow>
          columns={[
            { key: 'entity', header: 'Store / Head Office', render: (row) => <div>{row.entityName}<p className="text-xs text-slate-400">{row.entityCode}</p></div> },
            ...columns,
          ]}
          rows={storeReport.loading ? [] : storeReport.data ?? []}
          loading={storeReport.loading || entities.loading}
          error={storeReport.error || entities.error}
          empty="No ledger movements for this selection and month."
        />}
      </Card>
    </>
  );
}
