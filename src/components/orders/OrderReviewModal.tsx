import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { telHref, whatsappHref } from '@/lib/contactLinks';
import { formatCurrency, formatDateTime, titleCase, toneForStatus } from '@/lib/format';
import {
  ORDER_LINE_STATUS_LABEL,
  ORDER_LINE_STATUS_OPTIONS,
  ORDER_LINE_STATUS_TONE,
} from '@/lib/orderLineStatus';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/context/AuthContext';
import {
  markOrderConvertedToBill,
  markOrderStoreContacted,
  saveOrderReview,
  setOrderStatus,
} from '@/api/orders';
import { assignDeliveryBoy, listDeliveryBoys, type DeliveryBoy } from '@/api/deliveries';
import { listStores } from '@/api/stores';
import { updateMemberContact } from '@/api/users';
import type { Order, OrderLineStatus } from '@/types';

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

/**
 * The counter's view of one member order, in the same two steps as a
 * prescription: first each item's stock status (Stock available / Out of
 * stock / Not possible / Customer not needed), then the member's details.
 * "Submit" on the Details step saves both, and turns into "Convert to bill →",
 * which is the only way an order reaches the Bills page — pricing and the
 * OTP-gated payment collection all happen there, never here. That is also why
 * this modal never shows what was paid or its status: it belongs to the bill,
 * not to this review.
 *
 * "Next: Details →" only appears once "Process ✓" has grouped the items by
 * stock status — the counter works through the items first, in one pass,
 * before moving on to the member's details.
 */
export function OrderReviewModal({
  order,
  onClose,
  onSaved,
}: {
  order: Order;
  onClose: () => void;
  /** Called after anything is written, so the caller's list re-reads the row. */
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'items' | 'details'>('items');
  // Whether the items are showing grouped by stock status rather than in the
  // order they were placed — off until "Process" is pressed.
  const [processed, setProcessed] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, OrderLineStatus>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.id, l.status])),
  );

  // Member name/phone are the account's own — editing them here writes to that
  // row (see updateMemberContact), so the fix shows everywhere they're named.
  const [memberName, setMemberName] = useState(order.memberName);
  const [memberPhone, setMemberPhone] = useState(order.memberPhone);
  const [storeId, setStoreId] = useState(order.storeId);

  // True from a previous visit (`reviewedAt`) or the moment "Submit" succeeds
  // in this one — what swaps the footer's Submit for "Convert to bill →".
  const [submitted, setSubmitted] = useState(Boolean(order.reviewedAt));
  const [busy, setBusy] = useState<'submit' | 'convert' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When staff first used Call / WhatsApp here — the member's app shows the
  // order as "Store contact" from that moment (see noteContact below).
  const [contactedAt, setContactedAt] = useState(order.storeContactedAt);
  const [viewImage, setViewImage] = useState<{ src: string; title: string } | null>(null);

  const { accessToken } = useAuth();
  const { data: storeRows } = useAsync(() => listStores(accessToken), [accessToken]);
  const stores = storeRows ?? [];

  // Delivery boys at this order's branch — only fetched for a cash order still
  // pending payment, so most modal opens don't pay for this query.
  const [deliveryBoys, setDeliveryBoys] = useState<DeliveryBoy[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const needsDeliveryBoy =
    order.paymentMethodCode === 'cash' && order.paymentStatus === 'pending';

  useEffect(() => {
    if (!needsDeliveryBoy) {
      setDeliveryBoys([]);
      return;
    }
    let alive = true;
    listDeliveryBoys(order.storeCode || undefined)
      .then((boys) => {
        if (alive) setDeliveryBoys(boys);
      })
      .catch(() => {
        if (alive) setDeliveryBoys([]);
      });
    return () => {
      alive = false;
    };
  }, [needsDeliveryBoy, order.storeCode]);

  // A delivered or cancelled order is finished — it can still be looked at,
  // but there's nothing left to review or bill.
  const closed = order.status === 'delivered' || order.status === 'cancelled';
  const converted = Boolean(order.convertedToBillAt);

  const statusRank = useMemo(
    () =>
      Object.fromEntries(
        ORDER_LINE_STATUS_OPTIONS.map((o, rank) => [o.value, rank]),
      ) as Record<OrderLineStatus, number>,
    [],
  );
  const statusOf = (lineId: string, fallback: OrderLineStatus) =>
    statuses[lineId] ?? fallback;

  // Original line indices in display order: as placed, or — once "Process" is
  // pressed — grouped by status (each group keeping its relative order).
  const displayOrder = useMemo(() => {
    const indices = order.lines.map((_, i) => i);
    if (!processed) return indices;
    return [...indices].sort(
      (a, b) =>
        statusRank[statusOf(order.lines[a].id, order.lines[a].status)] -
        statusRank[statusOf(order.lines[b].id, order.lines[b].status)],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.lines, processed, statuses, statusRank]);

  const statusCounts = ORDER_LINE_STATUS_OPTIONS.map((o) => ({
    ...o,
    count: order.lines.filter((l) => statusOf(l.id, l.status) === o.value).length,
  })).filter((o) => o.count > 0);

  function validateDetails(): boolean {
    if (!memberName.trim() || !memberPhone.trim()) {
      setError('Member name and phone cannot be blank.');
      return false;
    }
    return true;
  }

  /** Writes everything on both steps: the member's contact corrections, each
   *  line's status, and the branch. Returns whether it actually saved. */
  async function saveAll(): Promise<boolean> {
    try {
      if (order.memberId) {
        // The member's account fields are shared with every other order and
        // script on it — check the phone isn't already someone else's first.
        const contactSaved = await updateMemberContact(order.memberId, {
          name: memberName,
          phone: memberPhone,
        });
        if (!contactSaved) {
          setError(
            `${memberPhone.trim()} is already used by a different account — pick a different number.`,
          );
          return false;
        }
      }
      await saveOrderReview(order.id, {
        lines: order.lines.map((l) => ({ id: l.id, status: statusOf(l.id, l.status) })),
        storeId: storeId || null,
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this order.');
      return false;
    }
  }

  async function submit() {
    if (!validateDetails()) return;
    setBusy('submit');
    setError(null);
    try {
      if (await saveAll()) {
        setSubmitted(true);
        onSaved();
      }
    } finally {
      setBusy(null);
    }
  }

  /** "Convert to bill →" — re-saves (Details may have been edited since
   *  Submit), stamps the order as converted so it starts showing on the Bills
   *  page, then hands off to that page with this order's bill already open. */
  async function convertToBill() {
    if (!validateDetails()) {
      setStep('details');
      return;
    }
    setBusy('convert');
    setError(null);
    try {
      if (!(await saveAll())) {
        setStep('details');
        return;
      }
      await markOrderConvertedToBill(order.id);
      onSaved();
      navigate(`/bills?open=${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert this order to a bill.');
      setStep('details');
    } finally {
      setBusy(null);
    }
  }

  /** Call / WhatsApp was tapped: stamp the order as contacted so the member's
   *  Track order moves to "Store contact". Fire-and-forget from the link's
   *  own onClick — the call or chat still opens whether or not this write
   *  lands — and a failure is shown rather than swallowed. */
  async function noteContact() {
    if (closed || contactedAt) return;
    try {
      const at = await markOrderStoreContacted(order.id);
      if (at) {
        setContactedAt(at);
        onSaved();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't record the contact: ${err.message}`
          : "Couldn't record the contact.",
      );
    }
  }

  async function cancelOrder() {
    setBusy('cancel');
    setError(null);
    try {
      await setOrderStatus(order.id, 'cancelled');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel this order.');
    } finally {
      setBusy(null);
    }
  }

  async function handleAssignDeliveryBoy(boyId: string) {
    setAssignError(null);
    setAssigning(true);
    try {
      await assignDeliveryBoy(order.id, boyId || null);
      onSaved();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Could not assign a delivery boy.');
    } finally {
      setAssigning(false);
    }
  }

  const working = busy !== null;

  const cancelButton = !closed && (
    <Button variant="danger" disabled={working} onClick={() => void cancelOrder()}>
      {busy === 'cancel' ? 'Cancelling…' : 'Cancel order'}
    </Button>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={order.code}
        footer={
          step === 'items' ? (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-xs text-slate-400">
                {!processed && order.lines.length > 0
                  ? 'Process the items above to continue.'
                  : ''}
              </span>
              <div className="flex gap-2">
                {cancelButton}
                {/* Gated on Process: the counter settles every item's stock
                    status in one pass before moving on to the member's
                    details, rather than the two steps being independent. An
                    order with nothing to process (no lines) has nothing to
                    gate on. */}
                {(processed || order.lines.length === 0) && (
                  <Button variant="primary" onClick={() => setStep('details')}>
                    Next: Details →
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={working}
                onClick={() => setStep('items')}
              >
                ← Back to items
              </Button>
              {cancelButton}
              {!closed &&
                (converted ? (
                  <Button
                    variant="primary"
                    disabled={working}
                    onClick={() => void convertToBill()}
                  >
                    {busy === 'convert' ? 'Opening…' : 'Open in Bills →'}
                  </Button>
                ) : submitted ? (
                  <Button
                    variant="primary"
                    disabled={working}
                    onClick={() => void convertToBill()}
                  >
                    {busy === 'convert' ? 'Converting…' : 'Convert to bill →'}
                  </Button>
                ) : (
                  <Button variant="primary" disabled={working} onClick={() => void submit()}>
                    {busy === 'submit' ? 'Submitting…' : 'Submit'}
                  </Button>
                ))}
              {closed && converted && (
                <Button variant="primary" onClick={() => navigate(`/bills?open=${order.id}`)}>
                  Open in Bills →
                </Button>
              )}
            </>
          )
        }
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge tone={toneForStatus(order.status)}>{titleCase(order.status)}</Badge>
            <Badge tone={order.fulfillmentType === 'home_delivery' ? 'blue' : 'gray'}>
              <Icon
                name={order.fulfillmentType === 'home_delivery' ? 'deliveries' : 'stores'}
                className="h-3 w-3"
              />
              {order.fulfillmentType === 'home_delivery' ? 'Home Delivery' : 'Store Pickup'}
            </Badge>
            {converted && <Badge tone="green">Converted to bill</Badge>}
          </div>
          <span className="text-xs font-medium text-slate-400">
            {step === 'items' ? '1 of 2 · Items' : '2 of 2 · Details'}
          </span>
        </div>

        {step === 'items' ? (
          <div>
            <p className="mb-3 text-xs text-slate-400">
              {order.memberName} · {order.memberPhone}
            </p>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Items
              </p>
              <button
                type="button"
                disabled={order.lines.length === 0}
                title={
                  processed
                    ? 'Show the items in the order they were placed again'
                    : 'Group the items below by stock status'
                }
                className="text-xs font-medium text-brand-600 disabled:cursor-not-allowed disabled:text-slate-300"
                onClick={() => setProcessed((p) => !p)}
              >
                {processed ? '← Unprocess' : 'Process ✓'}
              </button>
            </div>
            <p className="mb-2 text-xs text-slate-400">
              Set each item's stock status. Only items marked Stock available start on
              the bill; the status is for the counter only — never shown in the
              member's app.
            </p>

            {order.lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400">
                No line items recorded.
              </p>
            ) : (
              <div className="space-y-2">
                {displayOrder.map((i, pos) => {
                  const line = order.lines[i];
                  const status = statusOf(line.id, line.status);
                  const groupStart =
                    processed &&
                    (pos === 0 ||
                      statusOf(
                        order.lines[displayOrder[pos - 1]].id,
                        order.lines[displayOrder[pos - 1]].status,
                      ) !== status);
                  const groupSize = displayOrder.filter(
                    (j) => statusOf(order.lines[j].id, order.lines[j].status) === status,
                  ).length;
                  return (
                    <div key={line.id}>
                      {groupStart && (
                        <div className={`mb-1.5 flex items-center gap-2 ${pos === 0 ? '' : 'mt-3'}`}>
                          <Badge tone={ORDER_LINE_STATUS_TONE[status]}>
                            {ORDER_LINE_STATUS_LABEL[status]}
                          </Badge>
                          <span className="text-xs font-medium text-slate-400">
                            {groupSize} item{groupSize === 1 ? '' : 's'}
                          </span>
                        </div>
                      )}
                      <div className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800">{line.name}</p>
                            <p className="text-xs text-slate-400">
                              {line.pack ? `${line.pack} · ` : ''}×{line.qty} ·{' '}
                              {formatCurrency(line.unitPrice * line.qty)}
                            </p>
                          </div>
                          <Badge tone={ORDER_LINE_STATUS_TONE[status]}>
                            {ORDER_LINE_STATUS_LABEL[status]}
                          </Badge>
                        </div>
                        <select
                          value={status}
                          disabled={closed}
                          onChange={(e) =>
                            setStatuses((s) => ({
                              ...s,
                              [line.id]: e.target.value as OrderLineStatus,
                            }))
                          }
                          aria-label={`Stock status for ${line.name}`}
                          className={`${inputClass} mt-2`}
                        >
                          {ORDER_LINE_STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payment receipt
              </p>
              {!order.receipt ? (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400">
                  No receipt uploaded with this order.
                </p>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  {order.receipt.image ? (
                    <button
                      type="button"
                      onClick={() =>
                        setViewImage({
                          src: order.receipt!.image,
                          title: `${order.code} — receipt`,
                        })
                      }
                      className="h-20 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                    >
                      <img
                        src={order.receipt.image}
                        alt="Payment receipt"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-400">
                      No photo
                    </div>
                  )}
                  <div className="min-w-0 text-sm">
                    <p className="text-slate-800">
                      {order.receipt.payerName || 'Unnamed payer'}
                    </p>
                    <p className="text-xs text-slate-500">
                      Ref {order.receipt.reference || '—'} ·{' '}
                      {formatCurrency(order.receipt.amount)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDateTime(order.receipt.uploadedAt)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-lg">
            <DetailList
              rows={[
                {
                  label: 'Member',
                  value: (
                    <input
                      value={memberName}
                      disabled={closed}
                      onChange={(e) => setMemberName(e.target.value)}
                      placeholder="Member's name"
                      className={inputClass}
                    />
                  ),
                },
                {
                  label: 'Phone',
                  value: (
                    <div>
                      <div className="flex items-center gap-1.5">
                        <input
                          value={memberPhone}
                          disabled={closed}
                          onChange={(e) => setMemberPhone(e.target.value)}
                          placeholder="10-digit phone"
                          inputMode="tel"
                          className={`${inputClass} flex-1`}
                        />
                        {/* Straight from the number on screen — including a
                            correction just typed above, not yet saved — so the
                            counter can call to confirm it before committing. */}
                        <a
                          href={telHref(memberPhone)}
                          onClick={() => void noteContact()}
                          title="Call this number"
                          className={`shrink-0 rounded-md border border-slate-300 p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700 ${
                            telHref(memberPhone) ? '' : 'pointer-events-none opacity-40'
                          }`}
                        >
                          <Icon name="phone" className="h-3.5 w-3.5" />
                        </a>
                        <a
                          href={whatsappHref(memberPhone)}
                          onClick={() => void noteContact()}
                          target="_blank"
                          rel="noreferrer"
                          title="Message on WhatsApp"
                          className={`shrink-0 rounded-md border border-slate-300 p-[7px] text-emerald-600 hover:bg-emerald-50 ${
                            whatsappHref(memberPhone) ? '' : 'pointer-events-none opacity-40'
                          }`}
                        >
                          <Icon name="whatsapp" className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <p className="mt-1 text-xs font-normal text-slate-400">
                        {contactedAt
                          ? `Store contact recorded · ${formatDateTime(contactedAt)}`
                          : closed
                            ? 'Not contacted before this order closed.'
                            : 'Call or WhatsApp marks this order "Store contact" in the member\'s app.'}
                      </p>
                    </div>
                  ),
                },
                {
                  label: 'Branch',
                  value: (
                    <select
                      value={storeId}
                      disabled={closed}
                      onChange={(e) => setStoreId(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Not set — {order.storeName}</option>
                      {stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>
                  ),
                },
                {
                  label: 'Fulfilment',
                  value: (
                    <Badge tone={order.fulfillmentType === 'home_delivery' ? 'blue' : 'gray'}>
                      <Icon
                        name={order.fulfillmentType === 'home_delivery' ? 'deliveries' : 'stores'}
                        className="h-3 w-3"
                      />
                      {titleCase(order.fulfillmentType)}
                    </Badge>
                  ),
                },
                { label: 'Kind', value: titleCase(order.kind) },
                // Payment method, its status and every figure (MRP total,
                // delivery fee, paid) live on the Bill this order converts to,
                // not here — showing them on both screens is how the two
                // drift out of sync.
                { label: 'Placed', value: formatDateTime(order.placedAt) },
                {
                  label: 'Items',
                  value:
                    statusCounts.length === 0 ? (
                      'No line items'
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {statusCounts.map((o) => (
                          <Badge key={o.value} tone={ORDER_LINE_STATUS_TONE[o.value]}>
                            {o.label} · {o.count}
                          </Badge>
                        ))}
                      </div>
                    ),
                },
              ]}
            />

            {needsDeliveryBoy && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Delivery boy
                </p>
                <select
                  value={order.deliveryBoyId}
                  disabled={assigning}
                  onChange={(e) => void handleAssignDeliveryBoy(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Unassigned</option>
                  {/* Falls back to a synthetic option so the select still shows
                      the current name even if that boy didn't come back in this
                      branch's fetched roster (moved branch, deactivated). */}
                  {order.deliveryBoyId &&
                    !deliveryBoys.some((b) => b.id === order.deliveryBoyId) && (
                      <option value={order.deliveryBoyId}>
                        {order.deliveryBoyName || 'Unassigned'}
                      </option>
                    )}
                  {deliveryBoys.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {assignError && <p className="mt-2 text-xs text-rose-600">{assignError}</p>}
                <p className="mt-2 text-xs text-slate-400">
                  Only for handing this order to someone who will collect the cash in
                  person — that hand-off stays a one-tap "Mark cash collected" on
                  Deliveries, no OTP. If you'll be collecting it yourself, leave this
                  unassigned and use "Convert to bill →" below instead — it verifies
                  an OTP before drawing the wallet and taking cash, same as a
                  prescription.
                </p>
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}
            <p className="mt-3 text-xs text-slate-500">
              {converted
                ? order.billAmount > 0
                  ? `Bill: ${formatCurrency(order.billAmount)} (${order.billStatus === 'paid' ? 'Paid' : 'Pending'}) — managed on the Bills page.`
                  : 'Converted to a bill — price it and collect payment on the Bills page.'
                : submitted
                  ? order.paymentStatus === 'pending'
                    ? 'Submitted. "Convert to bill →" moves this to the Bills page, where payment is collected with OTP verification — the same as a prescription.'
                    : 'Submitted. Use "Convert to bill →" to move this order to the Bills page.'
                  : 'Submit saves the item statuses and these details. It doesn\'t bill the order yet.'}
            </p>
          </div>
        )}

        {step === 'items' && error && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}
      </Modal>

      <Modal
        open={Boolean(viewImage)}
        onClose={() => setViewImage(null)}
        title={viewImage?.title ?? ''}
      >
        {viewImage && (
          <img
            src={viewImage.src}
            alt={viewImage.title}
            className="max-h-[70vh] w-full object-contain"
          />
        )}
      </Modal>
    </>
  );
}
