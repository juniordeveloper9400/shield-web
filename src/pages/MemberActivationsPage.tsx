import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ReceiptThumb } from '@/components/ui/ReceiptThumb';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  titleCase,
  toneForStatus,
} from '@/lib/format';
import {
  VALIDITY_MONTHS,
  instalmentOn,
  monthlyRedeemableOf,
  planStateOf,
  releasedBy,
  remainingAfter,
  type PlanState,
} from '@/lib/healthPass';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/context/AuthContext';
import { getMemberWalletSummary, listActivationsForMember } from '@/api/activations';

const PLAN_STATE_LABEL: Record<PlanState, string> = {
  active: 'Active',
  waiting: 'Waiting',
  expired: 'Expired',
};
const PLAN_STATE_TONE: Record<PlanState, Tone> = {
  active: 'green',
  waiting: 'amber',
  expired: 'gray',
};

export default function MemberActivationsPage() {
  const { memberId = '' } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const { accessToken } = useAuth();

  const { data, loading, error } = useAsync(
    () => listActivationsForMember(memberId, accessToken),
    [memberId, accessToken],
  );
  const plans = useMemo(() => data ?? [], [data]);
  const member = plans[0];
  const asOf = useMemo(() => new Date(), []);

  const { data: walletSummary } = useAsync(
    () => getMemberWalletSummary(memberId, accessToken),
    [memberId, accessToken],
  );

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

      {/* The same wallet-level figures the member's own app shows on the
          front of their wallet card — balance, then "this month's
          allowance + carry-forward" broken into what's redeemable, what's
          already redeemed, and what's still available. */}
      {walletSummary && (
        <Card className="mb-6 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Wallet balance
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatCurrency(walletSummary.balance)}
          </p>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Monthly allowance + carry-forward
            </p>
            <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400">Redeemable</p>
                <p className="font-semibold text-slate-800">{formatCurrency(walletSummary.monthlyRedeemable)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Redeemed</p>
                <p className="font-semibold text-slate-800">{formatCurrency(walletSummary.redeemedThisMonth)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Available</p>
                <p className="font-semibold text-emerald-700">{formatCurrency(walletSummary.availableAllowance)}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

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
            {plans.map((p) => {
              // Active/Waiting/Expired, and the release progress, only
              // mean anything once a plan has actually been approved — a
              // pending/rejected/on-hold submission has no issuedOn yet.
              const approved = p.status === 'approved' && p.issuedOn && p.expiresOn;
              const loaded = p.credited;
              const state = approved ? planStateOf({ issuedOn: p.issuedOn, expiresOn: p.expiresOn }, asOf) : null;
              const released = approved ? instalmentOn(p.issuedOn, asOf) : 0;
              const releasedAmount = approved ? releasedBy(loaded, p.issuedOn, asOf) : 0;
              const remaining = approved ? remainingAfter(loaded, p.issuedOn, asOf) : 0;
              const perMonth = approved ? monthlyRedeemableOf(loaded) : 0;

              return (
                <li
                  key={p.id}
                  onClick={() => navigate(`/activations/${p.id}`)}
                  className="cursor-pointer px-4 py-3.5 hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

                    {state && <Badge tone={PLAN_STATE_TONE[state]}>{PLAN_STATE_LABEL[state]}</Badge>}
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
                  </div>

                  {/* Recharged/expires dates and release progress — only
                      meaningful for an approved plan, same fields the
                      member's own wallet card back shows. */}
                  {approved && (
                    <div className="mt-3 ml-[52px] max-w-md">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>Recharged {p.rechargedOn ? formatDate(p.rechargedOn) : '—'}</span>
                        <span className={state === 'expired' ? 'font-medium text-rose-600' : ''}>
                          Expires {formatDate(p.expiresOn)}
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${(released / VALIDITY_MONTHS) * 100}%` }}
                          />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-slate-500">
                          <span>
                            {released} of {VALIDITY_MONTHS} released · {formatCurrency(releasedAmount)} ({formatCurrency(perMonth)}/month)
                          </span>
                          <span>{formatCurrency(remaining)} left</span>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
