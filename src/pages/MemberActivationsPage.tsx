import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ReceiptThumb } from '@/components/ui/ReceiptThumb';
import {
  formatCurrency,
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
            : 'Health Pass plans awaiting approval'
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

      <Card>
        {loading ? (
          <p className="py-14 text-center text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="py-14 text-center text-sm text-rose-500">{error}</p>
        ) : plans.length === 0 ? (
          <p className="py-14 text-center text-sm text-slate-400">
            This member has no privilege plan awaiting approval.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {plans.map((p) => (
              <li
                key={p.id}
                onClick={() => navigate(`/activations/${p.id}`)}
                className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-slate-50"
              >
                <ReceiptThumb
                  image={p.receiptImage}
                  title={`${p.tier} · ${p.memberName} — payment receipt`}
                />

                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">
                    {p.tier} · {formatCurrency(p.amount)}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      +{formatCurrency(p.bonus)} bonus
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {p.cardNumber || '—'} · {p.storeName} ·{' '}
                    {formatDateTime(p.submittedAt)}
                  </p>
                </div>

                <Badge tone={toneForStatus(p.status)}>
                  {titleCase(p.status)}
                </Badge>

                {/* Approve/reject/hold only happen on the validation screen,
                    behind the verification checklist — this just opens it. */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/activations/${p.id}`);
                  }}
                >
                  Validate
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
