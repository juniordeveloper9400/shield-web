import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FilterSelect, SearchInput } from '@/components/ui/Filters';
import { Combobox } from '@/components/ui/Combobox';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { formatCurrency } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  ACCOUNT_EXPLANATIONS,
  movementBalance,
  ledgerReportCsv,
  subjectLedgerCsv,
  chartOfAccountsCsv,
  type StoreLedgerRow,
} from '@/lib/ledgerReport';
import {
  closeLedgerPeriod,
  getChartOfAccounts,
  getLedgerEntities,
  getLedgerPeriods,
  getSubjectLedger,
  getTrialBalance,
  type LedgerEntity,
  type SubjectLedgerLine,
  type TrialBalanceRow,
  type ChartOfAccount,
} from '@/api/ledger';
import { listUsers } from '@/api/users';

const ACCOUNT_TYPES = [
  { value: '', label: 'Every account type' },
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'REVENUE', label: 'Revenue' },
  { value: 'EXPENSE', label: 'Expense' },
];

const TYPE_BADGE_TONE: Record<string, Tone> = {
  ASSET: 'blue',
  LIABILITY: 'amber',
  EQUITY: 'violet',
  REVENUE: 'green',
  EXPENSE: 'red',
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expenses',
};

type View = 'trial' | 'store' | 'person' | 'chart';

const VIEWS: { value: View; label: string; description: string }[] = [
  { value: 'trial', label: 'Trial balance', description: 'One row per account, for the selected store or Head Office.' },
  { value: 'store', label: 'Store-wise report', description: 'Every store and Head Office shown separately.' },
  { value: 'person', label: 'Person ledger', description: "One member, agent or investor's own Debit, Credit and closing balance." },
  { value: 'chart', label: 'Chart of accounts', description: 'Master chart of all accounts, classifications, descriptions and current balances.' },
];

const DATE_PRESETS = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'today', label: 'Today' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'this_fy', label: 'This Financial Year' },
  { value: 'custom', label: 'Custom Date Range' },
];

function formatDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDateRangeForPreset(preset: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  if (preset === 'today') {
    const today = formatDateString(now);
    return { fromDate: today, toDate: today };
  }
  if (preset === 'this_month') {
    const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { fromDate: from, toDate: to };
  }
  if (preset === 'last_month') {
    const prevMonthDate = new Date(y, m - 1, 1);
    const py = prevMonthDate.getFullYear();
    const pm = prevMonthDate.getMonth();
    const from = `${py}-${String(pm + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(py, pm + 1, 0).getDate();
    const to = `${py}-${String(pm + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { fromDate: from, toDate: to };
  }
  if (preset === 'last_30_days') {
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { fromDate: formatDateString(past), toDate: formatDateString(now) };
  }
  if (preset === 'this_fy') {
    const fyStartYear = m >= 3 ? y : y - 1;
    return {
      fromDate: `${fyStartYear}-04-01`,
      toDate: `${fyStartYear + 1}-03-31`,
    };
  }
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { fromDate: from, toDate: to };
}

/** The double-entry journal underneath the existing per-module money tables */
export default function LedgerPage() {
  const { user, accessToken } = useAuth();
  const canClosePeriods = user?.role === 'superadmin';

  const [view, setView] = useState<View>('trial');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [infoCollapsed, setInfoCollapsed] = useState(false);

  const initialRange = useMemo(() => getDateRangeForPreset('this_month'), []);
  const [datePreset, setDatePreset] = useState('this_month');
  const [fromDate, setFromDate] = useState(initialRange.fromDate);
  const [toDate, setToDate] = useState(initialRange.toDate);
  const [period, setPeriod] = useState(initialRange.fromDate);

  const entities = useAsync(() => getLedgerEntities(accessToken), [accessToken]);
  const [entityId, setEntityId] = useState<number | null>(null);
  const [accountType, setAccountType] = useState('');
  const [accountCodeFilter, setAccountCodeFilter] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Collapsible state for reports
  const [trialViewMode, setTrialViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [collapsedTrialTypes, setCollapsedTrialTypes] = useState<Record<string, boolean>>({});
  const [collapsedStores, setCollapsedStores] = useState<Record<string, boolean>>({});
  const [collapsedChartTypes, setCollapsedChartTypes] = useState<Record<string, boolean>>({});

  // Chart of accounts search & filters
  const [chartSearch, setChartSearch] = useState('');
  const [chartTypeFilter, setChartTypeFilter] = useState('');
  const [chartStatusFilter, setChartStatusFilter] = useState<'all' | 'provisional' | 'reviewed'>('all');

  function handlePresetChange(val: string) {
    setDatePreset(val);
    if (val !== 'custom') {
      const range = getDateRangeForPreset(val);
      setFromDate(range.fromDate);
      setToDate(range.toDate);
      setPeriod(`${range.fromDate.slice(0, 7)}-01`);
    }
  }

  function handleFromDateChange(val: string) {
    setFromDate(val);
    setDatePreset('custom');
    if (val) setPeriod(`${val.slice(0, 7)}-01`);
  }

  function handleToDateChange(val: string) {
    setToDate(val);
    setDatePreset('custom');
  }

  const balance = useAsync(
    () =>
      view === 'trial' || view === 'chart'
        ? getTrialBalance(accessToken, {
            entityId: entityId ?? undefined,
            fromDate,
            toDate,
            period,
            type: view === 'trial' ? accountType || undefined : undefined,
          })
        : Promise.resolve([]),
    [view, accessToken, entityId, fromDate, toDate, period, accountType],
  );

  const periods = useAsync(
    () => (entityId === null ? Promise.resolve([]) : getLedgerPeriods(accessToken, entityId)),
    [accessToken, entityId],
  );

  const storeReport = useAsync(async () => {
    if (view !== 'store') return [] as StoreLedgerRow[];
    const selected = (entities.data ?? []).filter((entity) => entityId === null || entity.id === entityId);
    const reports = await Promise.all(
      selected.map(async (entity) => {
        const rows = await getTrialBalance(accessToken, {
          entityId: entity.id,
          fromDate,
          toDate,
          period,
          type: accountType || undefined,
        });
        return rows.map((row) => ({
          ...row,
          id: `${entity.id}-${row.accountCode}`,
          entityName: entity.name,
          entityCode: entity.code,
        }));
      }),
    );
    return reports.flat();
  }, [view, entities.data, accessToken, entityId, fromDate, toDate, period, accountType]);

  const dateLabel = fromDate === toDate ? fromDate : `${fromDate}_to_${toDate}`;
  const displayPeriod = `${fromDate} to ${toDate}`;

  function downloadStoreReport() {
    const csv = ledgerReportCsv(storeReport.data ?? [], displayPeriod);
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sahakar-store-ledger-${dateLabel}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadTrialBalance() {
    const rows = balanceRows.map((row) => ({
      ...row,
      entityName: entityOptions.find((e) => e.value === String(entityId))?.label ?? 'All stores + Head Office',
      entityCode: entityOptions.find((e) => e.value === String(entityId))?.value ? 'STORE' : 'ALL',
    }));
    const csv = ledgerReportCsv(rows, displayPeriod);
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sahakar-trial-balance-${dateLabel}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ---- Person ledger ----
  const [personAccountCode, setPersonAccountCode] = useState('2001');
  const [personValue, setPersonValue] = useState('');

  // Every account filter dropdown on this page — person ledger, chart of
  // accounts master, and the trial-balance/store-wise "Account" filter below
  // — reads from the same `app.chart_of_account` table via this one call,
  // not a hardcoded list, so a newly added account shows up here too.
  const accounts = useAsync(() => getChartOfAccounts(accessToken), [accessToken]);

  const selectedEntityCode = entityId === null ? undefined : entities.data?.find((e) => e.id === entityId)?.code;
  const people = useAsync(
    () =>
      view === 'person'
        ? listUsers(selectedEntityCode && selectedEntityCode !== 'HQ' ? selectedEntityCode : undefined, accessToken)
        : Promise.resolve([]),
    [view, selectedEntityCode, accessToken],
  );

  const personOptions = useMemo(() => {
    return (people.data ?? []).flatMap((u) => {
      if (u.persona === 'agent' && u.agentId) {
        return [{ value: `agent:${u.agentId}`, label: `${u.name} — Agent ${u.agentCode} · ${u.phone}` }];
      }
      if (u.persona === 'investor' && u.investorId) {
        return [{ value: `investor:${u.investorId}`, label: `${u.name} — Investor ${u.investorCode} · ${u.phone}` }];
      }
      return [{ value: `member:${u.id}`, label: `${u.name} — Member · ${u.phone}` }];
    });
  }, [people.data]);

  const [personSubjectType, personSubjectId] = personValue ? personValue.split(':') : ['', ''];

  const subjectLedger = useAsync(
    () =>
      view === 'person' && personSubjectType && personSubjectId
        ? getSubjectLedger(accessToken, {
            subjectType: personSubjectType,
            subjectId: Number(personSubjectId),
            accountCode: personAccountCode,
            fromDate,
            toDate,
            period,
            entityId: entityId ?? undefined,
          })
        : Promise.resolve(null),
    [view, personSubjectType, personSubjectId, personAccountCode, fromDate, toDate, period, entityId, accessToken],
  );

  const accountOptions = useMemo(() => {
    return [
      { value: '', label: 'Choose an account' },
      ...(accounts.data ?? []).map((a) => ({
        value: a.code,
        label: `${a.code} · ${a.name} (${a.type})`,
      })),
    ];
  }, [accounts.data]);

  // The Trial balance/Store-wise "Account" filter — every row straight from
  // `app.chart_of_account` (via getChartOfAccounts), narrowed to whichever
  // account type is already picked above, so the list stays relevant
  // instead of showing every account regardless of that filter.
  const trialAccountOptions = useMemo(() => {
    const rows = (accounts.data ?? []).filter((a) => !accountType || a.type === accountType);
    return [
      { value: '', label: 'All accounts' },
      ...rows.map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` })),
    ];
  }, [accounts.data, accountType]);

  const lineColumns: Column<Omit<SubjectLedgerLine, 'id'> & { id: string }>[] = [
    { key: 'postedOn', header: 'Date', render: (row) => row.postedOn },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <div>
          <p className="text-slate-800">{row.description}</p>
          <p className="text-xs text-slate-400">{row.event}</p>
        </div>
      ),
    },
    {
      key: 'debit',
      header: 'Debit',
      render: (row) => (row.debit > 0 ? formatCurrency(row.debit) : '—'),
      className: 'text-right',
    },
    {
      key: 'credit',
      header: 'Credit',
      render: (row) => (row.credit > 0 ? formatCurrency(row.credit) : '—'),
      className: 'text-right',
    },
  ];

  function downloadSubjectLedger() {
    if (!subjectLedger.data) return;
    const personLabel = personOptions.find((p) => p.value === personValue)?.label ?? personValue;
    const csv = subjectLedgerCsv(
      {
        personName: personLabel,
        accountCode: subjectLedger.data.accountCode,
        accountName: subjectLedger.data.accountName,
        openingBalance: subjectLedger.data.openingBalance,
        closingBalance: subjectLedger.data.closingBalance,
      },
      subjectLedger.data.lines,
      displayPeriod,
    );
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sahakar-person-ledger-${subjectLedger.data.accountCode}-${dateLabel}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const currentPeriodRow = useMemo(
    () => periods.data?.find((p) => p.period.slice(0, 10) === period),
    [periods.data, period],
  );
  const isClosed = Boolean(currentPeriodRow?.closedAt);

  const balanceRows = useMemo(() => {
    const rows = (balance.data ?? []).map((row) => ({ ...row, id: row.accountCode }));
    return accountCodeFilter ? rows.filter((row) => row.accountCode === accountCodeFilter) : rows;
  }, [balance.data, accountCodeFilter]);

  const totals = useMemo(() => {
    return {
      debit: balanceRows.reduce((s, r) => s + r.debit, 0),
      credit: balanceRows.reduce((s, r) => s + r.credit, 0),
    };
  }, [balanceRows]);

  // Grouped trial balance by account type
  const groupedBalance = useMemo(() => {
    const groups: Record<string, (TrialBalanceRow & { id: string })[]> = {
      ASSET: [],
      LIABILITY: [],
      EQUITY: [],
      REVENUE: [],
      EXPENSE: [],
    };
    for (const row of balanceRows) {
      if (!groups[row.accountType]) {
        groups[row.accountType] = [];
      }
      groups[row.accountType].push(row);
    }
    return groups;
  }, [balanceRows]);

  const groupTotals = useMemo(() => {
    const result: Record<string, { debit: number; credit: number; net: number }> = {};
    for (const [type, rows] of Object.entries(groupedBalance)) {
      const debit = rows.reduce((s, r) => s + r.debit, 0), credit = rows.reduce((s, r) => s + r.credit, 0);
      result[type] = { debit, credit, net: debit - credit };
    }
    return result;
  }, [groupedBalance]);

  // Grouped store report
  const groupedStores = useMemo(() => {
    const groups: Record<string, { entityName: string; entityCode: string; rows: StoreLedgerRow[] }> = {};
    const source = accountCodeFilter
      ? (storeReport.data ?? []).filter((row) => row.accountCode === accountCodeFilter)
      : storeReport.data ?? [];
    for (const row of source) {
      const key = row.entityCode;
      if (!groups[key]) {
        groups[key] = { entityName: row.entityName, entityCode: row.entityCode, rows: [] };
      }
      groups[key].rows.push(row);
    }
    return groups;
  }, [storeReport.data, accountCodeFilter]);

  // ---- Chart of Accounts Master Model ----
  const enrichedAccounts = useMemo(() => {
    const balanceMap = new Map<string, TrialBalanceRow>();
    for (const b of balance.data ?? []) {
      balanceMap.set(b.accountCode, b);
    }
    return (accounts.data ?? []).map((acc) => {
      const movement = balanceMap.get(acc.code);
      return {
        code: acc.code,
        name: acc.name,
        type: acc.type,
        isProvisional: acc.isProvisional,
        explanation: ACCOUNT_EXPLANATIONS[acc.code] ?? '',
        debit: movement?.debit ?? 0,
        credit: movement?.credit ?? 0,
        net: movement?.net ?? 0,
        hasMovement: Boolean(movement && (movement.debit > 0 || movement.credit > 0)),
      };
    });
  }, [accounts.data, balance.data]);

  const filteredChartAccounts = useMemo(() => {
    const q = chartSearch.trim().toLowerCase();
    return enrichedAccounts.filter((acc) => {
      const matchesSearch =
        !q ||
        acc.code.toLowerCase().includes(q) ||
        acc.name.toLowerCase().includes(q) ||
        acc.explanation.toLowerCase().includes(q);
      const matchesType = !chartTypeFilter || acc.type === chartTypeFilter;
      const matchesStatus =
        chartStatusFilter === 'all' ||
        (chartStatusFilter === 'provisional' ? acc.isProvisional : !acc.isProvisional);
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [enrichedAccounts, chartSearch, chartTypeFilter, chartStatusFilter]);

  const chartKPIs = useMemo(() => {
    const all = enrichedAccounts;
    const assets = all.filter((a) => a.type === 'ASSET');
    const liabilities = all.filter((a) => a.type === 'LIABILITY');
    const equity = all.filter((a) => a.type === 'EQUITY');
    const revenue = all.filter((a) => a.type === 'REVENUE');
    const expense = all.filter((a) => a.type === 'EXPENSE');

    return {
      totalCount: all.length,
      assetsCount: assets.length,
      assetsDebit: assets.reduce((s, a) => s + a.debit, 0),
      liabilitiesCount: liabilities.length,
      liabilitiesCredit: liabilities.reduce((s, a) => s + a.credit, 0),
      equityCount: equity.length,
      revenueCount: revenue.length,
      revenueCredit: revenue.reduce((s, a) => s + a.credit, 0),
      expenseCount: expense.length,
      expenseDebit: expense.reduce((s, a) => s + a.debit, 0),
    };
  }, [enrichedAccounts]);

  const groupedChartAccounts = useMemo(() => {
    const groups: Record<string, typeof filteredChartAccounts> = {
      ASSET: [],
      LIABILITY: [],
      EQUITY: [],
      REVENUE: [],
      EXPENSE: [],
    };
    for (const acc of filteredChartAccounts) {
      if (!groups[acc.type]) groups[acc.type] = [];
      groups[acc.type].push(acc);
    }
    return groups;
  }, [filteredChartAccounts]);

  function downloadChartCsv() {
    const csv = chartOfAccountsCsv(filteredChartAccounts);
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sahakar-chart-of-accounts.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

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
            <p className="font-mono text-xs font-semibold text-slate-500">{row.accountCode}</p>
            <p className="font-medium text-slate-800">{row.accountName}</p>
            {ACCOUNT_EXPLANATIONS[row.accountCode] && (
              <p className="text-xs text-slate-500">({ACCOUNT_EXPLANATIONS[row.accountCode]})</p>
            )}
          </div>
          {row.isProvisional && <Badge tone="amber">Provisional</Badge>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => <Badge tone={TYPE_BADGE_TONE[row.accountType] ?? 'gray'}>{row.accountType}</Badge>,
    },
    {
      key: 'debit',
      header: 'Debit',
      render: (row) => formatCurrency(row.debit),
      className: 'text-right font-medium',
    },
    {
      key: 'credit',
      header: 'Credit',
      render: (row) => formatCurrency(row.credit),
      className: 'text-right font-medium',
    },
    {
      key: 'net',
      header: 'Net movement',
      render: (row) => {
        const movement = movementBalance(row.debit, row.credit);
        return (
          <span className="font-semibold text-slate-900">
            {formatCurrency(movement.amount)} {movement.side}
          </span>
        );
      },
      className: 'text-right',
    },
  ];

  const entityOptions = [
    { value: '', label: 'All stores + Head Office' },
    ...(entities.data ?? []).map((e: LedgerEntity) => ({ value: String(e.id), label: e.name })),
  ];

  // Helper collapse handlers
  function toggleTrialType(t: string) {
    setCollapsedTrialTypes((prev) => ({ ...prev, [t]: !prev[t] }));
  }
  function expandAllTrialTypes() {
    setCollapsedTrialTypes({});
  }
  function collapseAllTrialTypes() {
    const all: Record<string, boolean> = {};
    for (const k of Object.keys(groupedBalance)) all[k] = true;
    setCollapsedTrialTypes(all);
  }

  function toggleStore(code: string) {
    setCollapsedStores((prev) => ({ ...prev, [code]: !prev[code] }));
  }
  function expandAllStores() {
    setCollapsedStores({});
  }
  function collapseAllStores() {
    const all: Record<string, boolean> = {};
    for (const k of Object.keys(groupedStores)) all[k] = true;
    setCollapsedStores(all);
  }

  function toggleChartType(t: string) {
    setCollapsedChartTypes((prev) => ({ ...prev, [t]: !prev[t] }));
  }
  function expandAllChartTypes() {
    setCollapsedChartTypes({});
  }
  function collapseAllChartTypes() {
    const all: Record<string, boolean> = {};
    for (const k of Object.keys(groupedChartAccounts)) all[k] = true;
    setCollapsedChartTypes(all);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title="Ledger"
          subtitle="Double-entry journal underneath the money tables — one entity per shop, plus Head Office for commissions, wallets and reserves that aren't tied to any one store."
        />
        <div className="flex items-center gap-2">
          {sidebarCollapsed && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSidebarCollapsed(false)}
              className="flex items-center gap-1.5"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
              Show Filters & Reports
            </Button>
          )}
        </div>
      </div>

      {/* Accounting Guidance Card with collapse toggle */}
      <Card className="mb-6 overflow-hidden text-sm text-slate-600 transition-all">
        <div
          onClick={() => setInfoCollapsed(!infoCollapsed)}
          className="flex cursor-pointer items-center justify-between bg-slate-50/70 px-4 py-2.5 hover:bg-slate-100/70"
        >
          <div className="flex items-center gap-2 font-medium text-slate-700">
            <svg className="h-4 w-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>Accounting Guidance & Principles</span>
            <span className="text-xs text-slate-400 font-normal">
              ({infoCollapsed ? 'Click to expand details' : 'Provisional double-entry rules'})
            </span>
          </div>
          <button
            type="button"
            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
            aria-label="Toggle notice"
          >
            {infoCollapsed ? 'Expand ▼' : 'Collapse ▲'}
          </button>
        </div>
        {!infoCollapsed && (
          <div className="border-t border-slate-100 p-4 leading-relaxed">
            Figures show movements during the selected date range ({fromDate} to {toDate}), not current cash in hand or the
            remaining wallet balance. For wallet liability, Debit reduces what is owed and Credit increases it. Revenue is
            normally recorded as Credit; it is not a loss. Provisional means the account rules await accountant review.
            Head Office holds shared company accounts separately from stores.
          </div>
        )}
      </Card>

      {(entities.error || balance.error) && (
        <Card className="mb-6 border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
          {entities.error ?? balance.error}
        </Card>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ---- Left: filter sidebar ---- */}
        {!sidebarCollapsed && (
          <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-72">
            <Card className="divide-y divide-slate-200 shadow-sm">
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reports</p>
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(true)}
                    className="text-xs text-slate-400 hover:text-slate-600"
                    title="Hide sidebar to view full width report"
                  >
                    Hide ◀
                  </button>
                </div>
                <nav className="flex flex-col gap-1">
                  {VIEWS.map((v) => (
                    <button
                      key={v.value}
                      type="button"
                      onClick={() => setView(v.value)}
                      className={`rounded-md px-3 py-2 text-left text-sm transition ${
                        view === v.value
                          ? 'bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-200'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{v.label}</span>
                        {v.value === 'chart' && <Badge tone="blue">Master</Badge>}
                      </div>
                      <p className={`mt-0.5 text-xs font-normal ${view === v.value ? 'text-brand-600' : 'text-slate-400'}`}>
                        {v.description}
                      </p>
                    </button>
                  ))}
                </nav>
              </div>

              <div className="flex flex-col gap-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Date Filters</p>

                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  Preset Range
                  <FilterSelect
                    value={datePreset}
                    onChange={handlePresetChange}
                    options={DATE_PRESETS}
                    className="w-full"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-slate-500">
                    From Date
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => handleFromDateChange(e.target.value)}
                      aria-label="From Date"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-slate-500">
                    To Date
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => handleToDateChange(e.target.value)}
                      aria-label="To Date"
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </label>
                </div>

                <div className="mt-1 rounded bg-slate-50 p-2 text-center text-xs text-slate-500 font-mono">
                  {fromDate} → {toDate}
                </div>
              </div>

              <div className="flex flex-col gap-3 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Entity & Account</p>

                {view !== 'chart' && (
                  <label className="flex flex-col gap-1 text-xs text-slate-500">
                    Store / Head Office
                    <FilterSelect
                      value={entityId === null ? '' : String(entityId)}
                      onChange={(v) => setEntityId(v ? Number(v) : null)}
                      options={entityOptions.length > 0 ? entityOptions : [{ value: '', label: 'No entities yet' }]}
                      className="w-full"
                    />
                  </label>
                )}

                {(view === 'trial' || view === 'store') && (
                  <>
                    <label className="flex flex-col gap-1 text-xs text-slate-500">
                      Account type
                      <FilterSelect
                        value={accountType}
                        onChange={(v) => {
                          setAccountType(v);
                          // Clear a specific account pick that no longer
                          // belongs to the newly chosen type, rather than
                          // silently filtering every row out.
                          setAccountCodeFilter((current) => {
                            if (!current) return current;
                            const stillValid = (accounts.data ?? []).some(
                              (a) => a.code === current && (!v || a.type === v),
                            );
                            return stillValid ? current : '';
                          });
                        }}
                        options={ACCOUNT_TYPES}
                        className="w-full"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-500">
                      Account
                      <FilterSelect
                        value={accountCodeFilter}
                        onChange={setAccountCodeFilter}
                        options={trialAccountOptions}
                        className="w-full"
                      />
                    </label>
                  </>
                )}

                {view === 'person' && (
                  <>
                    <label className="flex flex-col gap-1 text-xs text-slate-500">
                      Account
                      <FilterSelect
                        value={personAccountCode}
                        onChange={setPersonAccountCode}
                        options={accountOptions}
                        className="w-full"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-slate-500">
                      Member / agent / investor
                      <Combobox
                        value={personValue}
                        onChange={setPersonValue}
                        options={personOptions}
                        placeholder="Choose a person…"
                        searchPlaceholder="Search by name or phone…"
                        className="w-full"
                      />
                    </label>
                  </>
                )}
              </div>

              {(view === 'trial' || view === 'store') && (
                <div className="flex flex-col gap-2 p-4">
                  {isClosed ? (
                    <Badge tone="gray">Closed by {currentPeriodRow?.closedBy ?? '—'}</Badge>
                  ) : (
                    canClosePeriods && (
                      <Button variant="secondary" size="sm" disabled={closing || entityId === null} onClick={handleClosePeriod}>
                        {closing ? 'Closing…' : 'Close this period'}
                      </Button>
                    )
                  )}
                  {closeError && <p className="text-xs text-rose-600">{closeError}</p>}
                </div>
              )}
            </Card>
          </aside>
        )}

        {/* ---- Right: the selected report ---- */}
        <div className="min-w-0 flex-1">
          {/* ===================== 1. TRIAL BALANCE ===================== */}
          {view === 'trial' && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Trial balance</h2>
                  <p className="text-xs text-slate-500">
                    Account movements from <span className="font-semibold text-slate-700">{fromDate}</span> to{' '}
                    <span className="font-semibold text-slate-700">{toDate}</span> for{' '}
                    {entityOptions.find((e) => e.value === String(entityId))?.label ?? 'All stores + Head Office'}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setTrialViewMode('grouped')}
                      className={`rounded px-2.5 py-1 font-medium transition ${
                        trialViewMode === 'grouped' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Collapsible Groups
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrialViewMode('flat')}
                      className={`rounded px-2.5 py-1 font-medium transition ${
                        trialViewMode === 'flat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Flat List
                    </button>
                  </div>

                  {trialViewMode === 'grouped' && (
                    <>
                      <Button variant="secondary" size="sm" onClick={expandAllTrialTypes}>
                        Expand All
                      </Button>
                      <Button variant="secondary" size="sm" onClick={collapseAllTrialTypes}>
                        Collapse All
                      </Button>
                    </>
                  )}

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={downloadTrialBalance}
                    disabled={balance.loading || !balance.data?.length}
                  >
                    Download CSV
                  </Button>
                </div>
              </div>

              {(accountType || accountCodeFilter) && (
                <div className="bg-amber-50/60 px-4 py-2 text-xs text-amber-800">
                  {accountCodeFilter ? (
                    <>
                      Showing only account <strong>{accountCodeFilter}</strong>. Choose "All accounts" to see every account
                      {accountType ? ` of type ${accountType}` : ''} again.
                    </>
                  ) : (
                    <>
                      Showing only <strong>{accountType}</strong> accounts. Select "Every account type" for the full balanced trial.
                    </>
                  )}
                </div>
              )}

              {balance.loading ? (
                <p className="p-8 text-center text-sm text-slate-400">Loading trial balance…</p>
              ) : balance.error ? (
                <p className="p-8 text-center text-sm text-rose-500">{balance.error}</p>
              ) : balanceRows.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">Nothing posted for this selection and date range yet.</p>
              ) : trialViewMode === 'flat' ? (
                <DataTable columns={columns} rows={balanceRows} loading={false} error={null} />
              ) : (
                /* Grouped Collapsible View */
                <div className="divide-y divide-slate-200">
                  {Object.entries(groupedBalance).map(([typeKey, rows]) => {
                    if (rows.length === 0) return null;
                    const isCollapsed = Boolean(collapsedTrialTypes[typeKey]);
                    const subtotal = groupTotals[typeKey] ?? { debit: 0, credit: 0, net: 0 };
                    const movement = movementBalance(subtotal.debit, subtotal.credit);

                    return (
                      <div key={typeKey} className="overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleTrialType(typeKey)}
                          className="flex w-full items-center justify-between bg-slate-50/80 px-4 py-3 text-left transition hover:bg-slate-100"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400 font-bold">{isCollapsed ? '▶' : '▼'}</span>
                            <Badge tone={TYPE_BADGE_TONE[typeKey] ?? 'gray'}>{typeKey}</Badge>
                            <span className="font-semibold text-slate-800">{TYPE_LABELS[typeKey] ?? typeKey}</span>
                            <span className="text-xs text-slate-500 font-normal">
                              ({rows.length} {rows.length === 1 ? 'account' : 'accounts'})
                            </span>
                          </div>
                          <div className="flex items-center gap-6 text-xs">
                            <span className="text-slate-500">
                              Debit: <strong className="font-semibold text-slate-800">{formatCurrency(subtotal.debit)}</strong>
                            </span>
                            <span className="text-slate-500">
                              Credit: <strong className="font-semibold text-slate-800">{formatCurrency(subtotal.credit)}</strong>
                            </span>
                            <span className="font-semibold text-slate-900">
                              Net: {formatCurrency(movement.amount)} {movement.side}
                            </span>
                          </div>
                        </button>

                        {!isCollapsed && (
                          <div className="border-t border-slate-100">
                            <DataTable columns={columns} rows={rows} loading={false} error={null} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {(balance.data?.length ?? 0) > 0 && (
                <div className="flex justify-end gap-6 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <span className="text-slate-500">
                    Total debit <span className="font-semibold text-slate-900">{formatCurrency(totals.debit)}</span>
                  </span>
                  <span className="text-slate-500">
                    Total credit <span className="font-semibold text-slate-900">{formatCurrency(totals.credit)}</span>
                  </span>
                  <span className="text-slate-500">
                    Net gap{' '}
                    <span className={`font-semibold ${totals.debit === totals.credit ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {formatCurrency(Math.abs(totals.debit - totals.credit))}{' '}
                      {totals.debit === totals.credit ? '(Balanced)' : totals.debit > totals.credit ? 'Dr' : 'Cr'}
                    </span>
                  </span>
                </div>
              )}
            </Card>
          )}

          {/* ===================== 2. STORE-WISE REPORT ===================== */}
          {view === 'store' && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Store-wise monthly ledger report</h2>
                  <p className="text-xs text-slate-500">
                    Each store and Head Office shown separately for period {fromDate} to {toDate}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={expandAllStores}>
                    Expand All
                  </Button>
                  <Button variant="secondary" size="sm" onClick={collapseAllStores}>
                    Collapse All
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={downloadStoreReport}
                    disabled={storeReport.loading || !storeReport.data?.length}
                  >
                    Download CSV
                  </Button>
                </div>
              </div>

              {storeReport.loading ? (
                <p className="p-8 text-center text-sm text-slate-400">Loading store reports…</p>
              ) : storeReport.error ? (
                <p className="p-8 text-center text-sm text-rose-500">{storeReport.error}</p>
              ) : Object.keys(groupedStores).length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-400">No ledger movements for this selection and date range.</p>
              ) : (
                <div className="divide-y divide-slate-200">
                  {Object.entries(groupedStores).map(([storeCode, storeGroup]) => {
                    const isCollapsed = Boolean(collapsedStores[storeCode]);
                    const debit = storeGroup.rows.reduce((s, r) => s + r.debit, 0);
                    const credit = storeGroup.rows.reduce((s, r) => s + r.credit, 0);
                    const net = movementBalance(debit, credit);

                    return (
                      <div key={storeCode} className="overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleStore(storeCode)}
                          className="flex w-full items-center justify-between bg-slate-50/80 px-4 py-3 text-left transition hover:bg-slate-100"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400 font-bold">{isCollapsed ? '▶' : '▼'}</span>
                            <Badge tone="blue">{storeGroup.entityCode}</Badge>
                            <span className="font-semibold text-slate-800">{storeGroup.entityName}</span>
                            <span className="text-xs text-slate-500 font-normal">
                              ({storeGroup.rows.length} {storeGroup.rows.length === 1 ? 'account' : 'accounts'})
                            </span>
                          </div>
                          <div className="flex items-center gap-6 text-xs">
                            <span className="text-slate-500">
                              Debit: <strong className="font-semibold text-slate-800">{formatCurrency(debit)}</strong>
                            </span>
                            <span className="text-slate-500">
                              Credit: <strong className="font-semibold text-slate-800">{formatCurrency(credit)}</strong>
                            </span>
                            <span className="font-semibold text-slate-900">
                              Net: {formatCurrency(net.amount)} {net.side}
                            </span>
                          </div>
                        </button>

                        {!isCollapsed && (
                          <div className="border-t border-slate-100">
                            <DataTable columns={columns} rows={storeGroup.rows} loading={false} error={null} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* ===================== 3. PERSON LEDGER ===================== */}
          {view === 'person' && (
            <Card>
              <CardHeader
                title="Person ledger"
                subtitle={`One member, agent or investor's own Debit, Credit and running Closing balance for ${fromDate} to ${toDate}.`}
              />
              {subjectLedger.data && (
                <div className="flex justify-end p-4 pb-0">
                  <Button variant="secondary" onClick={downloadSubjectLedger}>
                    Download CSV
                  </Button>
                </div>
              )}

              {(accounts.error || people.error || subjectLedger.error) && (
                <Card className="m-4 border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
                  {accounts.error ?? people.error ?? subjectLedger.error}
                </Card>
              )}

              {!personValue || !personAccountCode ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  Choose an account and a person on the left to inspect their ledger statement.
                </p>
              ) : subjectLedger.loading ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">Loading person ledger statement…</p>
              ) : subjectLedger.data ? (
                <>
                  <div className="flex flex-wrap gap-6 border-b border-slate-100 bg-slate-50/60 px-4 py-3 text-sm">
                    <span className="text-slate-500">
                      Opening balance{' '}
                      <span className="font-semibold text-slate-800">
                        {formatCurrency(subjectLedger.data.openingBalance)}
                      </span>
                    </span>
                    <span className="text-slate-500">
                      Debit{' '}
                      <span className="font-semibold text-slate-800">
                        {formatCurrency(subjectLedger.data.debit)}
                      </span>
                    </span>
                    <span className="text-slate-500">
                      Credit{' '}
                      <span className="font-semibold text-slate-800">
                        {formatCurrency(subjectLedger.data.credit)}
                      </span>
                    </span>
                    <span className="text-slate-500">
                      Closing balance{' '}
                      <span className="font-semibold text-slate-800">
                        {formatCurrency(subjectLedger.data.closingBalance)}
                      </span>
                    </span>
                  </div>
                  <DataTable
                    columns={lineColumns}
                    rows={subjectLedger.data.lines.map((l) => ({ ...l, id: String(l.id) }))}
                    loading={false}
                    error={null}
                    empty="No movement on this account for this person during the selected date range."
                  />
                </>
              ) : null}
            </Card>
          )}

          {/* ===================== 4. CHART OF ACCOUNTS MASTER ===================== */}
          {view === 'chart' && (
            <div className="flex flex-col gap-6">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                  <p className="text-xs font-medium text-slate-400">Total Accounts</p>
                  <p className="mt-1 text-xl font-bold text-slate-800">{chartKPIs.totalCount}</p>
                  <p className="mt-0.5 text-xs text-slate-400">System defined</p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-blue-700">Assets</p>
                    <Badge tone="blue">{chartKPIs.assetsCount}</Badge>
                  </div>
                  <p className="mt-1 text-lg font-bold text-blue-900">{formatCurrency(chartKPIs.assetsDebit)}</p>
                  <p className="mt-0.5 text-xs text-blue-600">Debit movement</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-amber-700">Liabilities</p>
                    <Badge tone="amber">{chartKPIs.liabilitiesCount}</Badge>
                  </div>
                  <p className="mt-1 text-lg font-bold text-amber-900">{formatCurrency(chartKPIs.liabilitiesCredit)}</p>
                  <p className="mt-0.5 text-xs text-amber-600">Credit movement</p>
                </div>
                <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-violet-700">Equity</p>
                    <Badge tone="violet">{chartKPIs.equityCount}</Badge>
                  </div>
                  <p className="mt-1 text-lg font-bold text-violet-900">Capital</p>
                  <p className="mt-0.5 text-xs text-violet-600">Adjustments</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-emerald-700">Revenue</p>
                    <Badge tone="green">{chartKPIs.revenueCount}</Badge>
                  </div>
                  <p className="mt-1 text-lg font-bold text-emerald-900">{formatCurrency(chartKPIs.revenueCredit)}</p>
                  <p className="mt-0.5 text-xs text-emerald-600">Credit movement</p>
                </div>
                <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-rose-700">Expenses</p>
                    <Badge tone="red">{chartKPIs.expenseCount}</Badge>
                  </div>
                  <p className="mt-1 text-lg font-bold text-rose-900">{formatCurrency(chartKPIs.expenseDebit)}</p>
                  <p className="mt-0.5 text-xs text-rose-600">Debit movement</p>
                </div>
              </div>

              {/* Main Card with filters & collapsible account types */}
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Chart of Accounts</h2>
                    <p className="text-xs text-slate-500">
                      Master catalogue of all general ledger accounts. Movements reflect {fromDate} to {toDate}.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={expandAllChartTypes}>
                      Expand All
                    </Button>
                    <Button variant="secondary" size="sm" onClick={collapseAllChartTypes}>
                      Collapse All
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={downloadChartCsv}
                      disabled={filteredChartAccounts.length === 0}
                    >
                      Download CSV
                    </Button>
                  </div>
                </div>

                {/* Filter and search toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 p-4">
                  <div className="w-full sm:w-72">
                    <SearchInput
                      value={chartSearch}
                      onChange={setChartSearch}
                      placeholder="Search by code (e.g. 1001) or name…"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Type Filter Pills */}
                    <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                      {['', 'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setChartTypeFilter(t)}
                          className={`rounded px-2.5 py-1 font-medium transition ${
                            chartTypeFilter === t
                              ? 'bg-brand-50 text-brand-700 font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {t === '' ? 'All' : TYPE_LABELS[t] ?? t}
                        </button>
                      ))}
                    </div>

                    {/* Status filter */}
                    <FilterSelect
                      value={chartStatusFilter}
                      onChange={(v) => setChartStatusFilter(v as 'all' | 'provisional' | 'reviewed')}
                      options={[
                        { value: 'all', label: 'All statuses' },
                        { value: 'provisional', label: 'Provisional only' },
                        { value: 'reviewed', label: 'Reviewed only' },
                      ]}
                      className="w-36 text-xs"
                    />
                  </div>
                </div>

                {accounts.loading ? (
                  <p className="p-8 text-center text-sm text-slate-400">Loading Chart of Accounts…</p>
                ) : filteredChartAccounts.length === 0 ? (
                  <p className="p-8 text-center text-sm text-slate-400">No accounts match the current filter or search.</p>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {Object.entries(groupedChartAccounts).map(([typeKey, list]) => {
                      if (list.length === 0) return null;
                      const isCollapsed = Boolean(collapsedChartTypes[typeKey]);
                      const totalDebit = list.reduce((s, a) => s + a.debit, 0);
                      const totalCredit = list.reduce((s, a) => s + a.credit, 0);

                      return (
                        <div key={typeKey} className="overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleChartType(typeKey)}
                            className="flex w-full items-center justify-between bg-slate-50/80 px-4 py-3 text-left transition hover:bg-slate-100"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-slate-400 font-bold">{isCollapsed ? '▶' : '▼'}</span>
                              <Badge tone={TYPE_BADGE_TONE[typeKey] ?? 'gray'}>{typeKey}</Badge>
                              <span className="font-semibold text-slate-800">{TYPE_LABELS[typeKey] ?? typeKey}</span>
                              <span className="text-xs text-slate-500 font-normal">
                                ({list.length} {list.length === 1 ? 'account' : 'accounts'})
                              </span>
                            </div>
                            <div className="flex items-center gap-6 text-xs">
                              <span className="text-slate-500">
                                Period Debit: <strong className="font-semibold text-slate-800">{formatCurrency(totalDebit)}</strong>
                              </span>
                              <span className="text-slate-500">
                                Period Credit: <strong className="font-semibold text-slate-800">{formatCurrency(totalCredit)}</strong>
                              </span>
                            </div>
                          </button>

                          {!isCollapsed && (
                            <div className="divide-y divide-slate-100 border-t border-slate-100">
                              <div className="hidden grid-cols-12 bg-slate-50/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:grid">
                                <div className="col-span-2">Code</div>
                                <div className="col-span-4">Account name & explanation</div>
                                <div className="col-span-2 text-center">Status</div>
                                <div className="col-span-2 text-right">Debit movement</div>
                                <div className="col-span-2 text-right">Credit movement</div>
                              </div>
                              {list.map((acc) => (
                                <div
                                  key={acc.code}
                                  className="grid grid-cols-1 gap-2 p-4 transition hover:bg-slate-50/70 sm:grid-cols-12 sm:items-center sm:gap-4 sm:py-3"
                                >
                                  <div className="sm:col-span-2">
                                    <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">
                                      {acc.code}
                                    </span>
                                  </div>
                                  <div className="sm:col-span-4">
                                    <p className="font-medium text-slate-900">{acc.name}</p>
                                    {acc.explanation && (
                                      <p className="mt-0.5 text-xs text-slate-500">{acc.explanation}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 sm:col-span-2 sm:justify-center">
                                    {acc.isProvisional ? (
                                      <Badge tone="amber">Provisional</Badge>
                                    ) : (
                                      <Badge tone="green">Reviewed</Badge>
                                    )}
                                  </div>
                                  <div className="text-xs sm:col-span-2 sm:text-right">
                                    <span className="font-medium text-slate-800">
                                      {acc.debit > 0 ? formatCurrency(acc.debit) : '—'}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-xs sm:col-span-2 sm:justify-end sm:gap-3">
                                    <span className="font-medium text-slate-800">
                                      {acc.credit > 0 ? formatCurrency(acc.credit) : '—'}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      {['2001', '2002', '2003'].includes(acc.code) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setPersonAccountCode(acc.code);
                                            setView('person');
                                          }}
                                          className="text-xs font-medium text-brand-600 hover:underline"
                                          title="Open in person ledger"
                                        >
                                          Ledger →
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
