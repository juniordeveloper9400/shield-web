import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canReviewActivations } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { Icon } from '@/components/ui/Icon';
import { PrivilegeCard } from '@/components/ui/PrivilegeCard';
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
  holdActivation,
  rejectActivation,
  saveActivationVerification,
} from '@/api/activations';

const inputClass =
  'w-full max-w-[220px] rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400';

/** ISO timestamp/date → the `YYYY-MM-DD` a `date` input wants, or ''. */
function toDateInputValue(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

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

  // Reject and hold both need a note from the reviewer before they submit;
  // this is which one that note is for, or null for the plain button row.
  const [noteAction, setNoteAction] = useState<'reject' | 'hold' | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ---- The reviewer's own verification checklist ---------------------------
  // Local form state, seeded from whatever was last saved for this card, and
  // re-seeded whenever a fresh load of it comes in (a reload after Save, or
  // switching cards). Gates the Approve button on its own (instant feedback);
  // the actual write happens on Save, and again — enforced — inside
  // [approve] before [approveActivation] is ever called.
  const [verifiedReference, setVerifiedReference] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [receiptVerified, setReceiptVerified] = useState(false);
  const [receivedAmount, setReceivedAmount] = useState('');
  const [verifySaving, setVerifySaving] = useState(false);
  const [verifySavedAt, setVerifySavedAt] = useState<number | null>(null);
  // Whether "Save verification" has actually been clicked for exactly what's
  // on screen right now — false again the moment any of the four fields
  // change, so a stale verification can never wave through edited figures
  // (or approve one). This is what gates the mismatch highlighting and the
  // Approve button, not just having filled the fields in.
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setVerifiedReference(selected.verifiedReference);
    setReceivedOn(toDateInputValue(selected.receivedOn));
    setReceiptVerified(selected.receiptVerified);
    setReceivedAmount(
      selected.receivedAmount > 0 ? String(selected.receivedAmount) : '',
    );
    setVerifySavedAt(null);
    setVerified(false);
  }, [selected]);

  function editField<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setVerified(false);
    };
  }
  const changeVerifiedReference = editField(setVerifiedReference);
  const changeReceivedOn = editField(setReceivedOn);
  const changeReceiptVerified = editField(setReceiptVerified);
  const changeReceivedAmount = editField(setReceivedAmount);

  const receivedAmountNumber = Number(receivedAmount);
  const checklistComplete =
    verifiedReference.trim() !== '' &&
    receivedOn !== '' &&
    receiptVerified &&
    receivedAmount.trim() !== '' &&
    Number.isFinite(receivedAmountNumber) &&
    receivedAmountNumber > 0;
  const amountMismatch =
    selected != null &&
    receivedAmount.trim() !== '' &&
    Number.isFinite(receivedAmountNumber) &&
    receivedAmountNumber !== selected.amount;
  // The mismatch only actually shows once the reviewer has run "Save
  // verification" on these exact figures — typing a wrong number in
  // mid-entry shouldn't flash red before they've even finished.
  const showAmountMismatch = verified && amountMismatch;

  const editable =
    canReview && (selected?.status === 'pending' || selected?.status === 'on_hold');

  const back = () =>
    navigate(
      selected?.memberId
        ? `/activations/member/${selected.memberId}`
        : '/activations',
    );

  async function saveVerification(): Promise<boolean> {
    setVerifySaving(true);
    setActionError(null);
    try {
      const ok = await saveActivationVerification(id, {
        verifiedReference,
        receivedOn,
        receiptVerified,
        receivedAmount: receivedAmount.trim() === '' ? null : receivedAmountNumber,
      });
      if (!ok) {
        setActionError('This activation is no longer pending — reloading.');
        reload();
        return false;
      }
      setVerifySavedAt(Date.now());
      setVerified(true);
      return true;
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not save the verification.',
      );
      return false;
    } finally {
      setVerifySaving(false);
    }
  }

  async function approve() {
    if (!canReview) {
      setActionError('Only a Super Admin can approve activations.');
      return;
    }
    if (!checklistComplete) {
      setActionError('Complete the verification checklist before approving.');
      return;
    }
    if (!verified) {
      setActionError('Click "Save verification" first — approving needs it saved, not just filled in.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      // The checklist is saved for real before it is ever trusted to gate
      // real money — approveActivation checks the same four columns again
      // server-side, so a save that silently failed here must never let the
      // credit through looking successful.
      const saved = await saveActivationVerification(id, {
        verifiedReference,
        receivedOn,
        receiptVerified,
        receivedAmount: receivedAmountNumber,
      });
      if (!saved) {
        setActionError('This activation is no longer pending — reloading.');
        reload();
        return;
      }
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

  async function hold() {
    if (!canReview) {
      setActionError('Only a Super Admin can hold activations.');
      return;
    }
    if (!note.trim()) {
      setActionError('Give the member a reason it is on hold.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const ok = await holdActivation(id, note);
      if (!ok) {
        setActionError('This activation is no longer pending — reloading.');
        reload();
        return;
      }
      setNoteAction(null);
      setNote('');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not hold.');
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
        subtitle="Health Pass plan activation review"
        actions={
          <Button variant="secondary" size="sm" onClick={back}>
            ← Back
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
            <div className="mb-4 flex flex-wrap items-start gap-4">
              <div className="w-full max-w-sm">
                <PrivilegeCard
                  tierKind={selected.tierKind}
                  tierName={selected.tier}
                  cardNumber={selected.cardNumber}
                  holder={selected.memberName}
                  amount={selected.amount}
                  bonus={selected.bonus}
                  status={titleCase(selected.status)}
                  footNote={
                    selected.status === 'approved' && selected.expiresOn
                      ? `Expires ${formatDate(selected.expiresOn)}`
                      : undefined
                  }
                />
              </div>

              {/* The member's wallet at a glance, right beside the card being
                  activated — balance and points, and a way straight to their
                  full profile. No transaction history here — see the page's
                  own note on that further down. */}
              <div className="flex min-w-[220px] flex-1 flex-col gap-2 rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Member wallet
                </p>
                {activity.loading ? (
                  <p className="text-sm text-slate-400">Loading…</p>
                ) : activity.error ? (
                  <p className="text-sm text-rose-600">{activity.error}</p>
                ) : activity.data ? (
                  <>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <span>
                        <span className="text-slate-400">Balance </span>
                        <span className="font-semibold text-slate-800">
                          {formatCurrency(activity.data.balance)}
                        </span>
                      </span>
                      <span>
                        <span className="text-slate-400">Points </span>
                        <span className="font-semibold text-slate-800">
                          {activity.data.rewardPoints}
                        </span>
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-fit"
                      onClick={() => navigate(`/users/${selected.memberId}`)}
                    >
                      Open member profile →
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

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
                {
                  label: 'Load',
                  value: (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{formatCurrency(selected.amount)}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={receivedAmount}
                        disabled={!editable}
                        onChange={(e) => changeReceivedAmount(e.target.value)}
                        placeholder="Received amount"
                        className={
                          showAmountMismatch
                            ? `${inputClass} border-rose-400 bg-rose-50 text-rose-700 focus:border-rose-500 focus:ring-rose-200`
                            : inputClass
                        }
                      />
                      {showAmountMismatch && (
                        <span className="text-xs font-medium text-rose-600">
                          Does not match {formatCurrency(selected.amount)}
                        </span>
                      )}
                    </div>
                  ),
                },
                { label: 'Bonus (10%)', value: formatCurrency(selected.bonus) },
                {
                  label: 'Credits on approval',
                  value: formatCurrency(selected.credited),
                },
                {
                  label: 'UTR / Transaction ID',
                  value: (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-500">
                        Member wrote: {selected.receiptReference || '—'}
                      </span>
                      <input
                        type="text"
                        value={verifiedReference}
                        disabled={!editable}
                        onChange={(e) => changeVerifiedReference(e.target.value)}
                        placeholder="Verified UTR / transaction id"
                        className={inputClass}
                      />
                    </div>
                  ),
                },
                { label: 'Receipt file', value: selected.receiptFileName || '—' },
                {
                  label: 'Submitted',
                  value: (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{formatDateTime(selected.submittedAt)}</span>
                      <input
                        type="date"
                        value={receivedOn}
                        disabled={!editable}
                        onChange={(e) => changeReceivedOn(e.target.value)}
                        className={inputClass}
                      />
                      <span className="text-xs text-slate-400">Received date</span>
                    </div>
                  ),
                },
                ...(selected.status === 'approved' && selected.issuedOn
                  ? [{ label: 'Plan issued', value: formatDate(selected.issuedOn) }]
                  : []),
                ...(selected.status === 'approved' && selected.expiresOn
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

            {showAmountMismatch && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-200">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Received amount ({formatCurrency(receivedAmountNumber)}) does not
                  match the load ({formatCurrency(selected.amount)}). Check before
                  approving.
                </span>
              </p>
            )}

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
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={receiptVerified}
                    disabled={!editable}
                    onChange={(e) => changeReceiptVerified(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  I have checked this receipt image and it matches the transfer.
                </label>
              </div>
            ) : (
              <>
                <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  No receipt image on file for this activation.
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={receiptVerified}
                    disabled={!editable}
                    onChange={(e) => changeReceiptVerified(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  No image on file, but I have verified this transfer another way.
                </label>
              </>
            )}

            {editable && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={verifySaving}
                  onClick={saveVerification}
                >
                  {verifySaving ? 'Saving…' : 'Save verification'}
                </Button>
                {verifySavedAt && verified && (
                  <span className="text-xs text-emerald-600">
                    Saved — Approve is unlocked.
                  </span>
                )}
                {!checklistComplete ? (
                  <span className="text-xs text-slate-400">
                    Fill in the UTR, received date, received amount and the
                    receipt tick above before Approve unlocks.
                  </span>
                ) : (
                  !verified && (
                    <span className="text-xs text-slate-400">
                      Click "Save verification" to unlock Approve.
                    </span>
                  )
                )}
              </div>
            )}

            {(selected.status === 'pending' || selected.status === 'on_hold') &&
              canReview && (
                <div className="mt-5 border-t border-slate-200 pt-4">
                  {noteAction ? (
                    <>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">
                        {noteAction === 'reject'
                          ? 'Reason for rejection'
                          : 'Reason it is on hold'}
                      </label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder={
                          noteAction === 'reject'
                            ? "The member sees this in their wallet, e.g. 'Receipt amount does not match the plan.'"
                            : "The member sees this in their wallet, e.g. 'Please re-upload a clearer receipt photo.'"
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={saving}
                          onClick={() => {
                            setNoteAction(null);
                            setNote('');
                            setActionError(null);
                          }}
                        >
                          Back
                        </Button>
                        <Button
                          variant={noteAction === 'reject' ? 'danger' : 'secondary'}
                          disabled={saving}
                          onClick={noteAction === 'reject' ? reject : hold}
                        >
                          {noteAction === 'reject'
                            ? 'Confirm rejection'
                            : 'Confirm hold'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        disabled={saving}
                        onClick={() => setNoteAction('reject')}
                      >
                        Reject
                      </Button>
                      {selected.status === 'pending' && (
                        <Button
                          variant="secondary"
                          disabled={saving}
                          onClick={() => setNoteAction('hold')}
                        >
                          Hold
                        </Button>
                      )}
                      <Button
                        variant="success"
                        disabled={saving || !checklistComplete || !verified}
                        title={
                          !checklistComplete
                            ? 'Complete the verification checklist above first.'
                            : !verified
                              ? 'Click "Save verification" above first.'
                              : undefined
                        }
                        onClick={approve}
                      >
                        <Icon name="check" className="h-4 w-4" /> Approve &amp; credit
                      </Button>
                    </div>
                  )}

                  {!noteAction && (
                    <p className="mt-3 text-xs text-slate-400">
                      Approving writes the activation and bonus to the member's
                      wallet ledger and adds {formatCurrency(selected.credited)} to
                      their balance.
                      {selected.status === 'pending' &&
                        ' Not ready to decide yet? Hold it with a note instead of leaving it silently pending.'}
                    </p>
                  )}
                </div>
              )}

            {(selected.status === 'pending' || selected.status === 'on_hold') &&
              !canReview && (
                <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                  <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This activation is awaiting review. Only a Super Admin can
                    approve, reject, or hold it.
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
