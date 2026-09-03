import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canReviewActivations } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { Icon } from '@/components/ui/Icon';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  titleCase,
  toneForStatus,
} from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  approveActivation,
  getActivation,
  getWalletActivity,
  rejectActivation,
} from '@/api/activations';

export default function ActivationDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReview = user ? canReviewActivations(user.role) : false;

  const { data: selected, loading, error, reload } = useAsync(
    () => getActivation(id),
    [id],
  );
  const activity = useAsync(() => getWalletActivity(id), [id]);

  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const back = () => navigate('/activations');

  async function approve() {
    if (!canReview) {
      setActionError('Only a Super Admin can approve activations.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const ok = await approveActivation(id);
      if (!ok) {
        setActionError('This activation is no longer pending — reloading.');
        reload();
        return;
      }
      back();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setSaving(false);
    }
  }

  async function reject() {
    if (!canReview) {
      setActionError('Only a Super Admin can reject activations.');
      return;
    }
    if (!note.trim()) {
      setActionError('Give the member a reason for the rejection.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await rejectActivation(id, note);
      back();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not reject.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={
          selected ? `${selected.tier} · ${selected.memberName}` : 'Activation'
        }
        subtitle="Privilege-plan activation review"
        actions={
          <Button variant="secondary" size="sm" onClick={back}>
            ← Back to activations
          </Button>
        }
      />

      <Card className="p-5">
        {loading ? (
          <p className="py-14 text-center text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="py-14 text-center text-sm text-rose-500">{error}</p>
        ) : !selected ? (
          <p className="py-14 text-center text-sm text-slate-400">
            This activation could not be found.
          </p>
        ) : (
          <>
            <div className="mb-3">
              <Badge tone={toneForStatus(selected.status)}>
                {titleCase(selected.status)}
              </Badge>
            </div>

            <DetailList
              rows={[
                { label: 'Member', value: selected.memberName },
                { label: 'Phone', value: selected.memberPhone },
                { label: 'Plan', value: selected.tier },
                { label: 'Branch', value: selected.storeName },
                { label: 'Card number', value: selected.cardNumber || '—' },
                { label: 'Load', value: formatCurrency(selected.amount) },
                { label: 'Bonus (10%)', value: formatCurrency(selected.bonus) },
                {
                  label: 'Credits on approval',
                  value: formatCurrency(selected.credited),
                },
                { label: 'Receipt ref', value: selected.receiptReference || '—' },
                { label: 'Receipt file', value: selected.receiptFileName || '—' },
                { label: 'Submitted', value: formatDateTime(selected.submittedAt) },
                ...(selected.issuedOn
                  ? [{ label: 'Plan issued', value: formatDate(selected.issuedOn) }]
                  : []),
                ...(selected.expiresOn
                  ? [
                      {
                        label: 'Plan expires',
                        value: formatDate(selected.expiresOn),
                      },
                    ]
                  : []),
                ...(selected.reviewedAt
                  ? [
                      {
                        label: 'Reviewed',
                        value: formatDateTime(selected.reviewedAt),
                      },
                    ]
                  : []),
                ...(selected.reviewerNote
                  ? [{ label: 'Reason', value: selected.reviewerNote }]
                  : []),
              ]}
            />

            {selected.receiptImage ? (
              <div className="mt-4">
                <p className="mb-1.5 text-sm font-medium text-slate-700">
                  Transfer receipt
                </p>
                <a
                  href={selected.receiptImage}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-slate-200"
                >
                  <img
                    src={selected.receiptImage}
                    alt="Transfer receipt uploaded by the member"
                    className="max-h-96 w-full bg-slate-50 object-contain"
                  />
                </a>
                <p className="mt-1 text-xs text-slate-400">
                  Tap to open full size in a new tab.
                </p>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                No receipt image on file for this activation.
              </p>
            )}

            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium text-slate-700">
                Member wallet
              </p>
              {activity.loading ? (
                <p className="text-sm text-slate-400">Loading wallet…</p>
              ) : activity.error ? (
                <p className="text-sm text-rose-600">{activity.error}</p>
              ) : activity.data ? (
                <div className="rounded-lg border border-slate-200">
                  <div className="flex flex-wrap gap-x-8 gap-y-1 border-b border-slate-200 px-3 py-2 text-sm">
                    <span>
                      <span className="text-slate-400">Balance </span>
                      <span className="font-medium text-slate-800">
                        {formatCurrency(activity.data.balance)}
                      </span>
                    </span>
                    <span>
                      <span className="text-slate-400">Points </span>
                      <span className="font-medium text-slate-800">
                        {activity.data.rewardPoints}
                      </span>
                    </span>
                    <span>
                      <span className="text-slate-400">Opened </span>
                      <span className="font-medium text-slate-800">
                        {activity.data.openedAt
                          ? formatDate(activity.data.openedAt)
                          : 'not yet'}
                      </span>
                    </span>
                  </div>
                  {activity.data.entries.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-slate-400">
                      No wallet activity yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {activity.data.entries.map((e) => (
                        <li
                          key={e.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-slate-700">
                              {e.label}
                            </span>
                            <span className="text-xs text-slate-400">
                              {titleCase(e.kind)} · {formatDate(e.occurredOn)}
                            </span>
                          </span>
                          <span
                            className={
                              e.amount < 0
                                ? 'shrink-0 font-medium text-rose-600'
                                : 'shrink-0 font-medium text-emerald-600'
                            }
                          >
                            {e.amount < 0 ? '−' : '+'}
                            {formatCurrency(Math.abs(e.amount))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>

            {selected.status === 'pending' && canReview && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                {rejecting ? (
                  <>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Reason for rejection
                    </label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      placeholder="The member sees this in their wallet, e.g. 'Receipt amount does not match the plan.'"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={saving}
                        onClick={() => {
                          setRejecting(false);
                          setActionError(null);
                        }}
                      >
                        Back
                      </Button>
                      <Button
                        variant="danger"
                        disabled={saving}
                        onClick={reject}
                      >
                        Confirm rejection
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      disabled={saving}
                      onClick={() => setRejecting(true)}
                    >
                      Reject
                    </Button>
                    <Button variant="success" disabled={saving} onClick={approve}>
                      <Icon name="check" className="h-4 w-4" /> Approve &amp; credit
                    </Button>
                  </div>
                )}

                {!rejecting && (
                  <p className="mt-3 text-xs text-slate-400">
                    Approving writes the activation and bonus to the member's
                    wallet ledger and adds {formatCurrency(selected.credited)} to
                    their balance.
                  </p>
                )}
              </div>
            )}

            {selected.status === 'pending' && !canReview && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This activation is awaiting review. Only a Super Admin can
                  approve or reject it.
                </span>
              </p>
            )}

            {actionError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
