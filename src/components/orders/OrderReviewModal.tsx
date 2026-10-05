import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { telHref, whatsappHref } from '@/lib/contactLinks';
import { formatCurrency, formatDateTime, titleCase } from '@/lib/format';
import {
  ORDER_LIFECYCLE_LABEL,
  ORDER_LIFECYCLE_TONE,
  orderLifecycleStatus,
} from '@/lib/orderLifecycle';
import {
  ORDER_LINE_STATUS_LABEL,
  ORDER_LINE_STATUS_OPTIONS,
  ORDER_LINE_STATUS_TONE,
} from '@/lib/orderLineStatus';
import { useAsync } from '@/lib/useAsync';
import { useConfirmDialog } from '@/lib/useConfirmDialog';
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

/** One row of the items table — either one of the order's own checkout
 *  lines (`isNew: false`, id is the real `order_line.id`) or a line the
 *  admin has added by hand this visit (`isNew: true`, id is a client-only
 *  placeholder until it's actually saved). */
interface OrderLineDraft {
  id: string;
  isNew: boolean;
  name: string;
  pack: string;
  unitPrice: number;
  qty: number;
  categoryTitle: string;
  status: OrderLineStatus;
}

/**
 * The counter's full-page view of one member order — one page, not the old
 * two-step "Items then Details" popover: the member's own details at the
 * top, the item table (checkbox to include/exclude, Stock status, a
 * three-dot menu) underneath, same shape as `PrescriptionReviewModal`.
 *
 * An original checkout line only ever has its Stock status changed here —
 * never its Name/Qty/Rate, which is what the member actually ordered (and
 * may have already paid for); only a line the admin adds fresh with
 * "+ Add new item" is fully editable and removable, via its own three-dot
 * menu. "Convert to bill →" saves everything and marks the order converted,
 * then just closes — the admin opens Bills on their own from there, same as
 * a prescription.
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
  // Member name/phone are the account's own — editing them here writes to that
  // row (see updateMemberContact), so the fix shows everywhere they're named.
  const [memberName, setMemberName] = useState(order.memberName);
  const [memberPhone, setMemberPhone] = useState(order.memberPhone);
  const [storeId, setStoreId] = useState(order.storeId);

  // True the moment "Process →" succeeds in this visit — set optimistically,
  // ahead of `onSaved()`'s reload actually landing a fresh `order.reviewedAt`,
  // so the footer swaps to "Convert to bill →" immediately rather than
  // flashing "Process →" again for the gap between the two.
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState<'process' | 'convert' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();
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
  const lifecycle = orderLifecycleStatus(order);
  // Reached "Processed" (or further) — either this visit's own "Process →"
  // just landed (`submitted`, before the reload behind it catches up), or a
  // previous visit already did, or staff used Call/WhatsApp instead (either
  // milestone counts the same way `orderLifecycleStatus` itself does). Once
  // true, the footer's primary action is "Convert to bill →" rather than
  // "Process →" — there's nothing left for a second click of the same button
  // to do.
  const processed = submitted || lifecycle !== 'pending';

  const [lines, setLines] = useState<OrderLineDraft[]>(() =>
    order.lines.map((l) => ({
      id: l.id,
      isNew: false,
      name: l.name,
      pack: l.pack,
      unitPrice: l.unitPrice,
      qty: l.qty,
      categoryTitle: l.categoryTitle,
      status: l.status,
    })),
  );
  const nextTempId = useRef(0);
  // Which added line's Name/Qty/Rate/Pack are showing as inputs right now —
  // only ever an `isNew` row; an original checkout line has nothing here to
  // edit beyond its Stock status, which is always live (no edit mode needed).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Which row's "⋮" menu (Edit / Delete) is open — only rendered for `isNew`
  // rows in the first place.
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (openRowMenu === null) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) {
        setOpenRowMenu(null);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [openRowMenu]);

  function patchLine(id: string, patch: Partial<OrderLineDraft>) {
    setLines((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  /** Only ever called on an `isNew` row — the three-dot menu never offers
   *  this for an original checkout line. */
  function removeLine(id: string) {
    setLines((rows) => rows.filter((r) => r.id !== id));
    setEditingId((cur) => (cur === id ? null : cur));
  }

  function addLine() {
    const id = `new-${nextTempId.current++}`;
    setLines((rows) => [
      ...rows,
      {
        id,
        isNew: true,
        name: '',
        pack: '',
        unitPrice: 0,
        qty: 1,
        categoryTitle: '',
        status: 'available',
      },
    ]);
    // Opens straight into edit mode — there's nothing useful to look at on
    // a blank row otherwise.
    setEditingId(id);
  }

  const namedCount = lines.filter((l) => l.name.trim()).length;
  const billableCount = lines.filter((l) => l.name.trim() && l.status !== 'not_possible').length;

  /** The header checkbox — every named line at once, same mechanism each
   *  row's own checkbox already uses. */
  function setAllBillable(selected: boolean) {
    setLines((rows) =>
      rows.map((r) =>
        r.name.trim() ? { ...r, status: selected ? 'available' : 'not_possible' } : r,
      ),
    );
  }

  function validateDetails(): boolean {
    if (!memberName.trim() || !memberPhone.trim()) {
      setError('Member name and phone cannot be blank.');
      return false;
    }
    return true;
  }

  /** Writes everything on this page: the member's contact corrections, each
   *  existing line's status, any brand-new lines, and the branch. Returns
   *  whether it actually saved. */
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
        lines: lines.filter((l) => !l.isNew).map((l) => ({ id: l.id, status: l.status })),
        newLines: lines
          .filter((l) => l.isNew && l.name.trim())
          .map((l) => ({
            name: l.name.trim(),
            pack: l.pack,
            unitPrice: l.unitPrice,
            qty: l.qty || 1,
            status: l.status,
          })),
        storeId: storeId || null,
      }, accessToken);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this order.');
      return false;
    }
  }

  /** "Process →" — the footer's primary action before the order has been
   *  reviewed at all: saves everything on the page (member details, each
   *  line's stock status, any items added by hand) and stamps the order's
   *  own `reviewed_at`, which is what actually moves it to "Processed"
   *  (`orderLifecycleStatus`). Stays open — there's still the item table to
   *  settle before converting. */
  async function process() {
    if (!validateDetails()) return;
    setBusy('process');
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

  /** "Convert to bill →" — the footer's primary action once the order has
   *  been processed, replacing "Process →" rather than sitting beside it
   *  (same as `PrescriptionReviewModal`'s own "Convert to bill →" replacing
   *  its Send/Update intake button). Saves everything above first (an edit
   *  here may not have been saved yet), stamps the order as converted so it
   *  starts showing on the Bills page, then just closes — the admin opens
   *  Bills on their own from there, same as a prescription. Pricing and the
   *  OTP-gated wallet/cash collection that reaches "Completed" both happen
   *  there, not in this modal — same as a prescription never shows a manual
   *  "Complete" button here either. */
  async function convertToBill() {
    if (!validateDetails()) return;
    setBusy('convert');
    setError(null);
    try {
      if (!(await saveAll())) return;
      await markOrderConvertedToBill(order.id, accessToken);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert this order to a bill.');
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
      const at = await markOrderStoreContacted(order.id, accessToken);
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

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="full"
        title={order.code}
        footer={
          <>
            {!closed && (
              <Button
                variant="danger"
                disabled={working}
                onClick={() =>
                  ask({
                    title: 'Cancel this order?',
                    message: `Order ${order.code} will be marked cancelled. This cannot be undone.`,
                    confirmLabel: 'Cancel order',
                    danger: true,
                    onConfirm: cancelOrder,
                  })
                }
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel order'}
              </Button>
            )}
            <Button variant="secondary" disabled={working} onClick={onClose}>
              Close
            </Button>
            {!closed &&
              (converted ? (
                <Button
                  disabled
                  title="Already converted — pricing and payment are on the Bills page now"
                >
                  Converted to bill
                </Button>
              ) : processed ? (
                <Button
                  variant="primary"
                  disabled={working || billableCount === 0}
                  title={billableCount === 0 ? 'Check at least one item first' : undefined}
                  onClick={() => void convertToBill()}
                >
                  {busy === 'convert' ? 'Converting…' : 'Convert to bill →'}
                </Button>
              ) : (
                <Button variant="primary" disabled={working} onClick={() => void process()}>
                  {busy === 'process' ? 'Processing…' : 'Process →'}
                </Button>
              ))}
          </>
        }
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge tone={ORDER_LIFECYCLE_TONE[lifecycle]}>{ORDER_LIFECYCLE_LABEL[lifecycle]}</Badge>
            <Badge tone={order.fulfillmentType === 'home_delivery' ? 'blue' : 'gray'}>
              <Icon
                name={order.fulfillmentType === 'home_delivery' ? 'deliveries' : 'stores'}
                className="h-3 w-3"
              />
              {order.fulfillmentType === 'home_delivery' ? 'Home Delivery' : 'Store Pickup'}
            </Badge>
            {converted && <Badge tone="green">Converted to bill</Badge>}
          </div>
          {processed && !converted && (
            <span className="text-xs font-medium text-slate-400">Saved</span>
          )}
        </div>

        {/* Top: the member's own details. */}
        <div className="mx-auto mb-6 max-w-2xl">
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
              { label: 'Kind', value: titleCase(order.kind) },
              // Payment method, its status and every figure (MRP total,
              // delivery fee, paid) live on the Bill this order converts to,
              // not here — showing them on both screens is how the two
              // drift out of sync.
              { label: 'Placed', value: formatDateTime(order.placedAt) },
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

          {!order.receipt ? null : (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payment receipt
              </p>
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
                  <p className="text-slate-800">{order.receipt.payerName || 'Unnamed payer'}</p>
                  <p className="text-xs text-slate-500">
                    Ref {order.receipt.reference || '—'} · {formatCurrency(order.receipt.amount)}
                  </p>
                  <p className="text-xs text-slate-400">{formatDateTime(order.receipt.uploadedAt)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom: the item table. */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items</p>
            <button
              type="button"
              disabled={closed}
              className="text-xs font-medium text-brand-600 disabled:cursor-not-allowed disabled:text-slate-300"
              onClick={addLine}
            >
              + Add new item
            </button>
          </div>
          <p className="mb-2 text-xs text-slate-400">
            Uncheck anything that shouldn't go on the bill — only an item the admin
            adds by hand can have its Name/Qty/Rate changed here; an original line is
            what the member actually ordered, so only its Stock status can move.
          </p>
          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400">
              No line items recorded.
            </p>
          ) : (
            <div className="overflow-x-auto overflow-y-visible rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={closed}
                        title={billableCount === namedCount ? 'Clear all' : 'Select all'}
                        checked={namedCount > 0 && billableCount === namedCount}
                        ref={(el) => {
                          if (!el) return;
                          el.indeterminate = billableCount > 0 && billableCount < namedCount;
                        }}
                        onChange={(e) => setAllBillable(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                    </th>
                    <th className="px-3 py-2">Product name</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Rate</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Pack</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((line) => {
                    const editing = line.isNew && editingId === line.id;
                    return (
                      <tr key={line.id} className="align-top">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            disabled={closed || !line.name.trim()}
                            checked={line.status !== 'not_possible'}
                            onChange={(e) =>
                              patchLine(line.id, {
                                status: e.target.checked ? 'available' : 'not_possible',
                              })
                            }
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                        </td>
                        <td className="min-w-[160px] px-3 py-2">
                          {editing ? (
                            <input
                              value={line.name}
                              onChange={(e) => patchLine(line.id, { name: e.target.value })}
                              placeholder="Item name"
                              className={inputClass}
                            />
                          ) : (
                            <span className="font-medium text-slate-700">{line.name}</span>
                          )}
                        </td>
                        <td className="w-20 px-3 py-2">
                          {editing ? (
                            <input
                              value={line.qty || ''}
                              onChange={(e) =>
                                patchLine(line.id, { qty: Number(e.target.value) || 0 })
                              }
                              placeholder="Qty"
                              inputMode="numeric"
                              className={inputClass}
                            />
                          ) : (
                            line.qty || '—'
                          )}
                        </td>
                        <td className="w-28 px-3 py-2">
                          {editing ? (
                            <input
                              value={line.unitPrice || ''}
                              onChange={(e) =>
                                patchLine(line.id, { unitPrice: Number(e.target.value) || 0 })
                              }
                              placeholder="Rate"
                              inputMode="decimal"
                              className={inputClass}
                            />
                          ) : (
                            formatCurrency(line.unitPrice)
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{line.categoryTitle || '—'}</td>
                        <td className="min-w-[110px] px-3 py-2">
                          {editing ? (
                            <input
                              value={line.pack}
                              onChange={(e) => patchLine(line.id, { pack: e.target.value })}
                              placeholder="Pack"
                              className={inputClass}
                            />
                          ) : (
                            line.pack || '—'
                          )}
                        </td>
                        <td className="min-w-[150px] px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <select
                              value={line.status}
                              disabled={closed}
                              onChange={(e) =>
                                patchLine(line.id, { status: e.target.value as OrderLineStatus })
                              }
                              className={inputClass}
                            >
                              {ORDER_LINE_STATUS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <Badge tone={ORDER_LINE_STATUS_TONE[line.status]}>
                              {ORDER_LINE_STATUS_LABEL[line.status]}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {/* Only an admin-added line has anything here to do —
                              an original checkout line's only edit is the
                              Stock status select above, already live. */}
                          {line.isNew && !closed && (
                            <div
                              className="relative inline-block"
                              ref={openRowMenu === line.id ? rowMenuRef : undefined}
                            >
                              <button
                                type="button"
                                title="Row actions"
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                onClick={() =>
                                  setOpenRowMenu((cur) => (cur === line.id ? null : line.id))
                                }
                              >
                                <Icon name="more-vertical" className="h-4 w-4" />
                              </button>
                              {openRowMenu === line.id && (
                                <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg">
                                  <button
                                    type="button"
                                    className="block w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                                    onClick={() => {
                                      setEditingId((cur) => (cur === line.id ? null : line.id));
                                      setOpenRowMenu(null);
                                    }}
                                  >
                                    {editing ? 'Done' : 'Edit'}
                                  </button>
                                  <button
                                    type="button"
                                    className="block w-full px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                                    onClick={() => {
                                      removeLine(line.id);
                                      setOpenRowMenu(null);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error && (
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

      {confirmDialog}
    </>
  );
}
