import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge, type Tone } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  getMoneyFlowSummary,
  getMonthlyMoneyFlow,
  listMoneyFlowEntries,
  moneyFlowKindLabel,
} from '@/api/accounts';
import type { MoneyFlowEntry, MoneyFlowKind } from '@/types';

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'order', label: 'Orders' },
  { value: 'lab_booking', label: 'Lab tests' },
  { value: 'appointment', label: 'Appointments' },
  { value: 'privilege_load', label: 'Privilege plan loads' },
  { value: 'agent_payout', label: 'Agent payouts' },
];

const DIRECTION_OPTIONS = [
  { value: 'all', label: 'In & out' },
  { value: 'in', label: 'Money in' },
  { value: 'out', label: 'Money out' },
];

/** One line of the "Revenue in" / "Paid out" breakdown cards. */
function BreakdownRow({
  label,
  count,
  amount,
  share,
  barClassName,
}: {
  label: string;
  count: number;
  amount: number;
  share: number;
  barClassName: string;
}) {
  return (
    <div className="px-5 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-sm font-semibold text-slate-900">{formatCurrency(amount)}</p>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${barClassName}`}
            style={{ width: `${Math.min(100, share)}%` }}
          />
        </div>
        <p className="w-24 shrink-0 text-right text-xs text-slate-400">
          {count} {count === 1 ? 'entry' : 'entries'}
        </p>
      </div>
    </div>
  );
}

const KIND_TONE: Record<MoneyFlowKind, Tone> = {
  order: 'blue',
  lab_booking: 'violet',
  appointment: 'green',
  privilege_load: 'amber',
  agent_payout: 'red',
};

export default function AccountsPage() {
  const summary = useAsync(getMoneyFlowSummary, []);
  const monthly = useAsync(() => getMonthlyMoneyFlow(6), []);
  const ledger = useAsync(() => listMoneyFlowEntries(200), []);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [direction, setDirection] = useState('all');

  const entries = useMemo(() => ledger.data ?? [], [ledger.data]);
  const months = monthly.data ?? [];
  const chartMax = Math.max(1, ...months.flatMap((m) => [m.in, m.out]));

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((row) => {
      const matchesQuery =
        !q || row.label.toLowerCase().includes(q) || row.detail.toLowerCase().includes(q);
      const matchesKind = kind === 'all' || row.kind === kind;
      const matchesDirection = direction === 'all' || row.direction === direction;
      return matchesQuery && matchesKind && matchesDirection;
    });
  }, [entries, search, kind, direction]);

  const s = summary.data;

  const columns: Column<MoneyFlowEntry>[] = [
    {
      key: 'when',
      header: 'Date',
      render: (row) => formatDateTime(row.occurredAt),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => <Badge tone={KIND_TONE[row.kind]}>{moneyFlowKindLabel(row.kind)}</Badge>,
    },
    {
      key: 'ref',
      header: 'Reference',
      render: (row) => (
        <div>
          <p className="text-slate-800">{row.label}</p>
          <p className="text-xs text-slate-400">{row.detail}</p>
        </div>
      ),
    },
    {
      key: 'direction',
      header: 'Flow',
      render: (row) => (
        <Badge tone={row.direction === 'in' ? 'green' : 'red'}>
          {row.direction === 'in' ? 'In' : 'Out'}
        </Badge>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => (
        <span
          className={`font-semibold ${row.direction === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}
        >
          {row.direction === 'in' ? '+' : '−'}
          {formatCurrency(row.amount)}
        </span>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Total money flow across the app — revenue collected, plans loaded, and payouts made."
      />

      {summary.error && (
        <Card className="mb-6 border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
          {summary.error}
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total revenue"
          value={s ? formatCurrency(s.revenue.total) : '—'}
          hint="Orders, labs, appointments & plan loads"
          icon="accounts"
          tone="green"
        />
        <StatCard
          label="Paid out"
          value={s ? formatCurrency(s.payouts.total) : '—'}
          hint={
            s && s.pendingAgentWithdrawalsCount > 0
              ? `+${formatCurrency(s.pendingAgentWithdrawalsTotal)} pending, not yet counted`
              : 'Agent commission withdrawals'
          }
          icon="wallet"
          tone="rose"
        />
        <StatCard
          label="Net money flow"
          value={s ? formatCurrency(s.net) : '—'}
          hint="Revenue minus payouts"
          icon="dashboard"
          tone="blue"
        />
        <StatCard
          label="Wallet balances outstanding"
          value={s ? formatCurrency(s.walletLiability) : '—'}
          hint="Held in member wallets, still spendable"
          icon="wallet"
          tone="violet"
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue in" subtitle="Money collected, by source" />
          <div className="divide-y divide-slate-100">
            <BreakdownRow
              label="Orders"
              count={s?.revenue.ordersCount ?? 0}
              amount={s?.revenue.ordersTotal ?? 0}
              share={s && s.revenue.total > 0 ? (s.revenue.ordersTotal / s.revenue.total) * 100 : 0}
              barClassName="bg-brand-600"
            />
            <BreakdownRow
              label="Lab tests"
              count={s?.revenue.labBookingsCount ?? 0}
              amount={s?.revenue.labBookingsTotal ?? 0}
              share={
                s && s.revenue.total > 0 ? (s.revenue.labBookingsTotal / s.revenue.total) * 100 : 0
              }
              barClassName="bg-violet-500"
            />
            <BreakdownRow
              label="Appointments"
              count={s?.revenue.appointmentsCount ?? 0}
              amount={s?.revenue.appointmentsTotal ?? 0}
              share={
                s && s.revenue.total > 0
                  ? (s.revenue.appointmentsTotal / s.revenue.total) * 100
                  : 0
              }
              barClassName="bg-emerald-500"
            />
            <BreakdownRow
              label="Privilege plan loads"
              count={s?.revenue.privilegeLoadsCount ?? 0}
              amount={s?.revenue.privilegeLoadsTotal ?? 0}
              share={
                s && s.revenue.total > 0
                  ? (s.revenue.privilegeLoadsTotal / s.revenue.total) * 100
                  : 0
              }
              barClassName="bg-amber-500"
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Paid out" subtitle="Money that has actually left the business" />
          <div className="divide-y divide-slate-100">
            <BreakdownRow
              label="Agent commission withdrawals"
              count={s?.payouts.agentWithdrawalsCount ?? 0}
              amount={s?.payouts.agentWithdrawalsTotal ?? 0}
              share={100}
              barClassName="bg-rose-500"
            />
          </div>
          {s && s.pendingAgentWithdrawalsCount > 0 && (
            <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              <Badge tone="amber">{s.pendingAgentWithdrawalsCount} pending</Badge>{' '}
              worth {formatCurrency(s.pendingAgentWithdrawalsTotal)} — requested but not yet paid,
              so not counted above.
            </div>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Money flow — last 6 months" subtitle="Revenue in vs. payouts out, by month" />
        <div className="px-5 py-5">
          <div className="mb-4 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-brand-600" /> Money in
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> Money out
            </span>
          </div>
          {monthly.loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : (
            <div className="flex items-end justify-between gap-2 overflow-x-auto sm:gap-4">
              {months.map((m) => (
                <div key={m.month} className="flex min-w-[64px] flex-1 flex-col items-center gap-1">
                  <div className="flex h-40 items-end gap-1">
                    <div className="flex flex-col items-center justify-end">
                      <span className="mb-1 text-[10px] font-medium text-slate-500">
                        {m.in > 0 ? formatCurrency(m.in) : ''}
                      </span>
                      <div
                        className="w-5 rounded-t bg-brand-600 sm:w-6"
                        style={{ height: `${Math.max(2, (m.in / chartMax) * 100)}%`, minHeight: m.in > 0 ? 4 : 0 }}
                      />
                    </div>
                    <div className="flex flex-col items-center justify-end">
                      <span className="mb-1 text-[10px] font-medium text-slate-500">
                        {m.out > 0 ? formatCurrency(m.out) : ''}
                      </span>
                      <div
                        className="w-5 rounded-t bg-rose-500 sm:w-6"
                        style={{ height: `${Math.max(2, (m.out / chartMax) * 100)}%`, minHeight: m.out > 0 ? 4 : 0 }}
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-xs font-medium text-slate-600">{m.month}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Recent money flow</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Every order, lab test, appointment, plan load and agent payout, one timeline.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search reference, member, agent…"
            />
            <FilterSelect value={kind} onChange={setKind} options={KIND_OPTIONS} />
            <FilterSelect value={direction} onChange={setDirection} options={DIRECTION_OPTIONS} />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={filteredEntries}
          loading={ledger.loading}
          error={ledger.error}
          empty="No money movements match your filters."
        />
      </Card>
    </>
  );
}
