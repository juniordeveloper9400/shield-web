import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { MoneyFlowEntry, MoneyFlowKind, MoneyFlowSummary, MonthlyMoneyFlow } from '@/types';

type Row = Record<string, unknown>;

/**
 * The Accounts page's headline numbers, in one round trip. Every subquery
 * excludes rows where nothing actually changed hands yet:
 * `CANCELLED` orders/bookings/appointments, and privilege-plan activations
 * that are still `PENDING` — those are counted only once a Super Admin
 * approves them, same as {@link listMoneyFlowEntries}.
 */
export async function getMoneyFlowSummary(): Promise<MoneyFlowSummary> {
  const rows = (await sql`
    SELECT
      COALESCE((SELECT SUM(paid_total) FROM app."order" WHERE status <> 'CANCELLED'), 0) AS orders_total,
      COALESCE((SELECT COUNT(*) FROM app."order" WHERE status <> 'CANCELLED'), 0) AS orders_count,
      COALESCE((SELECT SUM(total_price) FROM app.lab_booking WHERE status <> 'CANCELLED'), 0) AS lab_total,
      COALESCE((SELECT COUNT(*) FROM app.lab_booking WHERE status <> 'CANCELLED'), 0) AS lab_count,
      COALESCE((SELECT SUM(fee) FROM app.appointment WHERE status <> 'CANCELLED' AND fee IS NOT NULL), 0) AS appt_total,
      COALESCE((SELECT COUNT(*) FROM app.appointment WHERE status <> 'CANCELLED' AND fee IS NOT NULL AND fee > 0), 0) AS appt_count,
      COALESCE((SELECT SUM(amount) FROM app.wallet_card WHERE status = 'APPROVED'), 0) AS privilege_total,
      COALESCE((SELECT COUNT(*) FROM app.wallet_card WHERE status = 'APPROVED'), 0) AS privilege_count,
      COALESCE((SELECT SUM(amount) FROM app.agent_withdrawal WHERE status = 'PAID'), 0) AS agent_paid_total,
      COALESCE((SELECT COUNT(*) FROM app.agent_withdrawal WHERE status = 'PAID'), 0) AS agent_paid_count,
      COALESCE((SELECT SUM(amount) FROM app.agent_withdrawal WHERE status = 'PENDING'), 0) AS agent_pending_total,
      COALESCE((SELECT COUNT(*) FROM app.agent_withdrawal WHERE status = 'PENDING'), 0) AS agent_pending_count,
      COALESCE((SELECT SUM(balance) FROM app.wallet), 0) AS wallet_liability
  `) as Row[];

  const r = rows[0] ?? {};
  const revenue = {
    ordersTotal: num(r.orders_total),
    ordersCount: num(r.orders_count),
    labBookingsTotal: num(r.lab_total),
    labBookingsCount: num(r.lab_count),
    appointmentsTotal: num(r.appt_total),
    appointmentsCount: num(r.appt_count),
    privilegeLoadsTotal: num(r.privilege_total),
    privilegeLoadsCount: num(r.privilege_count),
    total: 0,
  };
  revenue.total =
    revenue.ordersTotal +
    revenue.labBookingsTotal +
    revenue.appointmentsTotal +
    revenue.privilegeLoadsTotal;

  const payouts = {
    agentWithdrawalsTotal: num(r.agent_paid_total),
    agentWithdrawalsCount: num(r.agent_paid_count),
    total: num(r.agent_paid_total),
  };

  return {
    revenue,
    payouts,
    net: revenue.total - payouts.total,
    walletLiability: num(r.wallet_liability),
    pendingAgentWithdrawalsTotal: num(r.agent_pending_total),
    pendingAgentWithdrawalsCount: num(r.agent_pending_count),
  };
}

const KIND_LABEL: Record<MoneyFlowKind, string> = {
  order: 'Order payment',
  lab_booking: 'Lab test payment',
  appointment: 'Appointment fee',
  privilege_load: 'Privilege plan load',
  agent_payout: 'Agent payout',
};

export function moneyFlowKindLabel(kind: MoneyFlowKind): string {
  return KIND_LABEL[kind];
}

/**
 * Every settled money movement — order payments, lab and appointment fees,
 * approved privilege-plan loads (all money in), and paid agent withdrawals
 * (money out) — merged into one timeline, newest first.
 */
export async function listMoneyFlowEntries(limit = 50): Promise<MoneyFlowEntry[]> {
  const rows = await query<Row>(
    `
    SELECT * FROM (
      SELECT o.id::text AS id, 'order' AS kind, 'in' AS direction,
             o.paid_total AS amount, o.placed_at AS occurred_at,
             o.code AS label, COALESCE(m.name, '—') AS detail
        FROM app."order" o
        LEFT JOIN app.users m ON m.id = o.member_id
       WHERE o.status <> 'CANCELLED'

      UNION ALL

      SELECT lb.id::text, 'lab_booking', 'in',
             lb.total_price, lb.created_at,
             'LB-' || lpad(lb.id::text, 4, '0'), COALESCE(m.name, '—')
        FROM app.lab_booking lb
        LEFT JOIN app.users m ON m.id = lb.member_id
       WHERE lb.status <> 'CANCELLED' AND lb.total_price > 0

      UNION ALL

      SELECT a.id::text, 'appointment', 'in',
             a.fee, a.created_at,
             COALESCE(a.doctor_name, 'Appointment'), COALESCE(m.name, '—')
        FROM app.appointment a
        LEFT JOIN app.users m ON m.id = a.member_id
       WHERE a.status <> 'CANCELLED' AND a.fee IS NOT NULL AND a.fee > 0

      UNION ALL

      SELECT wc.id::text, 'privilege_load', 'in',
             wc.amount, COALESCE(wc.reviewed_at, wc.submitted_at),
             mt.name, COALESCE(m.name, '—')
        FROM app.wallet_card wc
        JOIN app.wallet w      ON w.id  = wc.wallet_id
        JOIN app.users m       ON m.id  = w.member_id
        JOIN app.membership_tier mt ON mt.id = wc.tier_id
       WHERE wc.status = 'APPROVED'

      UNION ALL

      SELECT aw.id::text, 'agent_payout', 'out',
             aw.amount, COALESCE(aw.processed_on::timestamptz, aw.created_at),
             'Agent payout', COALESCE(ag.name, '—')
        FROM app.agent_withdrawal aw
        JOIN app.agent ag ON ag.id = aw.agent_id
       WHERE aw.status = 'PAID'
    ) flow
    ORDER BY occurred_at DESC
    LIMIT $1
    `,
    [limit],
  );

  return rows.map((r) => ({
    id: `${r.kind}-${r.id}`,
    kind: r.kind as MoneyFlowKind,
    direction: r.direction as 'in' | 'out',
    amount: num(r.amount),
    label: String(r.label),
    detail: String(r.detail),
    occurredAt: iso(r.occurred_at) ?? new Date(0).toISOString(),
  }));
}

/**
 * Revenue in vs. payouts out, grouped by calendar month, for the trailing
 * `months` months (default the current month plus the 5 before it).
 */
export async function getMonthlyMoneyFlow(months = 6): Promise<MonthlyMoneyFlow[]> {
  const rows = await query<Row>(
    `
    SELECT month, direction, SUM(amount) AS total FROM (
      SELECT date_trunc('month', d)::date AS month, 'in' AS direction, amt AS amount
        FROM (
          SELECT placed_at AS d, paid_total AS amt FROM app."order" WHERE status <> 'CANCELLED'
          UNION ALL
          SELECT created_at, total_price FROM app.lab_booking WHERE status <> 'CANCELLED'
          UNION ALL
          SELECT created_at, fee FROM app.appointment
           WHERE status <> 'CANCELLED' AND fee IS NOT NULL AND fee > 0
          UNION ALL
          SELECT COALESCE(reviewed_at, submitted_at), amount
            FROM app.wallet_card WHERE status = 'APPROVED'
        ) sources

      UNION ALL

      SELECT date_trunc('month', COALESCE(processed_on::timestamptz, created_at))::date,
             'out', amount
        FROM app.agent_withdrawal WHERE status = 'PAID'
    ) events
    WHERE month >= date_trunc('month', now()) - ($1 - 1) * interval '1 month'
    GROUP BY month, direction
    `,
    [months],
  );

  const buckets = new Map<string, { in: number; out: number }>();
  const now = new Date();
  const keyOf = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  const labelOf = (d: Date) =>
    d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  const order: { key: string; label: string }[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = keyOf(d);
    order.push({ key, label: labelOf(d) });
    buckets.set(key, { in: 0, out: 0 });
  }

  for (const r of rows) {
    const d = new Date(String(r.month));
    const key = keyOf(d);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the requested window
    if (r.direction === 'in') bucket.in = num(r.total);
    else bucket.out = num(r.total);
  }

  return order.map(({ key, label }) => ({ month: label, ...buckets.get(key)! }));
}
