import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PrivilegeCard } from '@/components/ui/PrivilegeCard';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  titleCase,
  toneForStatus,
} from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { listActivationsForMember } from '@/api/activations';

export default function MemberActivationsPage() {
  const { memberId = '' } = useParams<{ memberId: string }>();
  const navigate = useNavigate();

  const { data, loading, error } = useAsync(
    () => listActivationsForMember(memberId),
    [memberId],
  );
  const plans = useMemo(() => data ?? [], [data]);
  const member = plans[0];

  const totalLoad = plans.reduce((s, p) => s + p.amount, 0);
  const totalCredited = plans
    .filter((p) => p.status === 'approved')
    .reduce((s, p) => s + p.credited, 0);

  return (
    <>
      <PageHeader
        title={member ? member.memberName : 'Member plans'}
        subtitle={
          member
            ? `${member.memberPhone} · ${plans.length} privilege ${
                plans.length === 1 ? 'plan' : 'plans'
              }`
            : 'Privilege plans this member has activated'
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/activations')}
          >
            ← Back to privilege plans
          </Button>
        }
      />

      {plans.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-slate-500">Plans</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {plans.length}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500">Total loaded</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(totalLoad)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500">Credited (approved)</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatCurrency(totalCredited)}
            </p>
          </Card>
        </div>
      )}

      <Card className="p-5">
        {loading ? (
          <p className="py-14 text-center text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="py-14 text-center text-sm text-rose-500">{error}</p>
        ) : plans.length === 0 ? (
          <p className="py-14 text-center text-sm text-slate-400">
            This member has not activated any privilege plan.
          </p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {plans.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/activations/${p.id}`)}
                className="group text-left"
              >
                <PrivilegeCard
                  tierKind={p.tierKind}
                  tierName={p.tier}
                  cardNumber={p.cardNumber}
                  holder={p.memberName}
                  amount={p.amount}
                  bonus={p.bonus}
                  status={titleCase(p.status)}
                  footNote={
                    p.expiresOn ? `Expires ${formatDate(p.expiresOn)}` : undefined
                  }
                  className="transition group-hover:-translate-y-0.5 group-hover:shadow-lg"
                />
                <div className="mt-2 flex items-center justify-between px-1 text-xs text-slate-500">
                  <span className="flex items-center gap-2">
                    <Badge tone={toneForStatus(p.status)}>
                      {titleCase(p.status)}
                    </Badge>
                    {p.storeName}
                  </span>
                  <span>{formatDateTime(p.submittedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
