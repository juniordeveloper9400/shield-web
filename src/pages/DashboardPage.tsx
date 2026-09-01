import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  canAccess,
  scopeToStore,
  ROLE_LABELS,
  ROLE_SUMMARY,
} from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { formatDateTime, titleCase, toneForStatus } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listOrders } from '@/api/orders';
import { listPrescriptions } from '@/api/prescriptions';
import { listLabBookings } from '@/api/labBookings';
import { listAppointments } from '@/api/appointments';

export default function DashboardPage() {
  const { user } = useAuth();

  const show = {
    orders: user ? canAccess(user.role, 'orders') : false,
    prescriptions: user ? canAccess(user.role, 'prescriptions') : false,
    labOrders: user ? canAccess(user.role, 'lab_orders') : false,
    appointments: user ? canAccess(user.role, 'appointments') : false,
  };

  // Each source loads only if this role can see it — an empty resolved promise
  // otherwise, so the hook order stays stable.
  const orders = useAsync(
    () => (show.orders ? listOrders() : Promise.resolve([])),
    [show.orders],
  );
  const scripts = useAsync(
    () => (show.prescriptions ? listPrescriptions() : Promise.resolve([])),
    [show.prescriptions],
  );
  const bookings = useAsync(
    () => (show.labOrders ? listLabBookings() : Promise.resolve([])),
    [show.labOrders],
  );
  const appts = useAsync(
    () => (show.appointments ? listAppointments() : Promise.resolve([])),
    [show.appointments],
  );

  if (!user) return null;

  const loading =
    orders.loading || scripts.loading || bookings.loading || appts.loading;

  const myOrders = scopeToStore(orders.data ?? [], user);
  const myScripts = scopeToStore(scripts.data ?? [], user);
  const allBookings = bookings.data ?? [];
  const allAppts = appts.data ?? [];

  const processingOrders = myOrders.filter((o) => o.status === 'processing');
  const awaitingScripts = myScripts.filter((p) => p.status === 'awaiting_review');
  const requestedBookings = allBookings.filter((l) => l.status === 'requested');
  const requestedAppts = allAppts.filter((a) => a.status === 'requested');

  const attention: {
    id: string;
    label: string;
    meta: string;
    status: string;
    to: string;
    visible: boolean;
  }[] = [
    ...processingOrders.map((o) => ({
      id: o.id,
      label: o.code,
      meta: `Order • ${o.memberName} • ${o.storeName}`,
      status: o.status,
      to: '/orders',
      visible: show.orders,
    })),
    ...awaitingScripts.map((p) => ({
      id: p.id,
      label: p.code,
      meta: `Prescription • ${p.memberName} • ${p.storeName}`,
      status: 'awaiting_review',
      to: '/prescriptions',
      visible: show.prescriptions,
    })),
    ...requestedBookings.map((l) => ({
      id: l.id,
      label: l.code,
      meta: `Lab order • ${l.memberName} • ${l.packageName}`,
      status: l.status,
      to: '/lab-orders',
      visible: show.labOrders,
    })),
    ...requestedAppts.map((a) => ({
      id: a.id,
      label: a.memberName,
      meta: `Appointment • ${a.providerName}`,
      status: a.status,
      to: '/appointments',
      visible: show.appointments,
    })),
  ].filter((row) => row.visible);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        subtitle="Here's what's happening across the modules you manage."
      />

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone="blue">{ROLE_LABELS[user.role]}</Badge>
          <span className="text-sm text-slate-500">
            {user.loginId}
          </span>
          {user.storeCode && (
            <>
              <span className="hidden text-slate-300 sm:inline">•</span>
              <span className="text-sm text-slate-500">
                Branch <span className="font-medium text-slate-700">{user.storeCode}</span>
              </span>
            </>
          )}
          <span className="hidden text-slate-300 sm:inline">•</span>
          <span className="text-sm text-slate-500">
            Last sign-in {formatDateTime(user.lastLogin)}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-500">{ROLE_SUMMARY[user.role]}</p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {show.orders && (
          <StatCard
            label="Orders processing"
            value={processingOrders.length}
            hint={`${myOrders.length} in view`}
            icon="orders"
            tone="amber"
          />
        )}
        {show.prescriptions && (
          <StatCard
            label="Scripts to review"
            value={awaitingScripts.length}
            hint={`${myScripts.length} in view`}
            icon="prescriptions"
            tone="blue"
          />
        )}
        {show.labOrders && (
          <StatCard
            label="Lab orders requested"
            value={requestedBookings.length}
            hint={`${allBookings.length} total`}
            icon="labs"
            tone="violet"
          />
        )}
        {show.appointments && (
          <StatCard
            label="Appointments requested"
            value={requestedAppts.length}
            hint={`${allAppts.length} total`}
            icon="appointments"
            tone="green"
          />
        )}
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Needs attention"
          subtitle="Open items from the modules you can access"
        />
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            Loading…
          </div>
        ) : attention.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            You&apos;re all caught up. Nothing is waiting.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {attention.map((row) => (
              <li key={row.id}>
                <Link
                  to={row.to}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {row.label}
                    </p>
                    <p className="truncate text-xs text-slate-400">{row.meta}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={toneForStatus(row.status)}>
                      {titleCase(row.status)}
                    </Badge>
                    <Icon name="chevron-down" className="h-4 w-4 -rotate-90 text-slate-300" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
