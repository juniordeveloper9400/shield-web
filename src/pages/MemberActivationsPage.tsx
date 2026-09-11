import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canReviewActivations } from '@/config/permissions';
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
import { approveActivation, listActivationsForMember } from '@/api/activations';

export default function MemberActivationsPage() {
  const { memberId = '' } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReview = user ? canReviewActivations(user.role) : false;

  const { data, loading, error, reload } = useAsync(
    () => listActivationsForMember(memberId),
    [memberId],
  );
  const plans = useMemo(() => data ?? [], [data]);
  const member = plans[0];

  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const totalLoad = plans.reduce((s, p) => s + p.amount, 0);
  const totalCredited = plans
    .filter((p) => p.status === 'approved')
    .reduce((s, p) => s + p.credited, 0);

  async function approve(id: string) {
    setSavingId(id);
    setActionError(null);
    try {
      const ok = await approveActivation(id);
      if (!ok) {
        setActionError('This plan is no longer pending — reloading.');
      }
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setSavingId(null);
    }
  }

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

      {actionError && (
        <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {actionError}
        </p>
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
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
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

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/activations/${p.id}`)}
                >
                  Details
                </Button>

                {p.status === 'pending' && canReview && (
                  <Button
                    variant="success"
                    size="sm"
                    disabled={savingId !== null}
                    onClick={() => approve(p.id)}
                  >
                    {savingId === p.id ? 'Approving…' : 'Approve'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
