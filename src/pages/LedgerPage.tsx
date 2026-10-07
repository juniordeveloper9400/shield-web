import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FilterSelect } from '@/components/ui/Filters';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatCurrency } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
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
  const [entityId, setEntityId] = useState<number | null>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [accountType, setAccountType] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Default to the first entity once the list loads.
  useEffect(() => {
    if (entityId === null && entities.data && entities.data.length > 0) {
      setEntityId(entities.data[0].id);
    }
  }, [entities.data, entityId]);

  const balance = useAsync(
    () =>
      entityId === null
        ? Promise.resolve<TrialBalanceRow[]>([])
        : getTrialBalance(accessToken, { entityId, period, type: accountType || undefined }),
    [accessToken, entityId, period, accountType],
  );

  const periods = useAsync(
    () => (entityId === null ? Promise.resolve([]) : getLedgerPeriods(accessToken, entityId)),
    [accessToken, entityId],
  );

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
      header: 'Net (Dr − Cr)',
      render: (row) => (
        <span className={row.net >= 0 ? 'text-slate-900' : 'text-rose-600'}>
          {formatCurrency(row.net)}
        </span>
      ),
      className: 'text-right font-semibold',
    },
  ];

  const entityOptions = (entities.data ?? []).map((e: LedgerEntity) => ({
    value: String(e.id),
    label: e.isProvisional ? `${e.name} (provisional)` : e.name,
  }));

  return (
    <>
      <PageHeader
        title="Ledger"
        subtitle="Double-entry journal underneath the money tables — one entity per shop, plus Head Office for commissions, wallets and reserves that aren't tied to any one store."
      />

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
              onChange={(e) => setPeriod(`${e.target.value}-01`)}
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
          subtitle="Every account with at least one posted line this month, for the selected entity."
        />
        <DataTable
          columns={columns}
          rows={balanceRows}
          loading={balance.loading || entities.loading}
          error={balance.error}
          empty={entityId === null ? 'No legal entity exists yet.' : 'Nothing posted for this entity and month yet.'}
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
    </>
  );
}
