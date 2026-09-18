import { useEffect, useMemo, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Combobox } from '@/components/ui/Combobox';
import { DetailList } from '@/components/ui/DetailList';
import { formatCurrency, formatDateTime, toneForStatus } from '@/lib/format';
import {
  addCustomMedicineType,
  loadCustomMedicineTypes,
  MEDICINE_TYPES,
} from '@/lib/medicineTypes';
import {
  addCustomFrequency,
  INTAKE_FREQUENCIES,
  loadCustomFrequencies,
  type FrequencyPreset,
} from '@/lib/intakeFrequencies';
import {
  addCustomRouteTime,
  composeDropRoute,
  isDropRouteCode,
  loadCustomRouteTimes,
  parseDropRoute,
  ROUTE_TIME_PRESETS,
  type DropRouteCode,
} from '@/lib/routeTimes';
import {
  savePrescriptionIntake,
  setPrescriptionImageRotation,
  setPrescriptionStatus,
  updatePrescriptionBranch,
  updatePrescriptionDetails,
  updatePrescriptionPatient,
} from '@/api/prescriptions';
import { sendOrderInvoice, setOrderStatus } from '@/api/orders';
import { collectBillWithWallet, getWalletBalanceForMember } from '@/api/billPayments';
import { confirmDeliveryOtp, describeOtpError, sendDeliveryOtp } from '@/lib/deliveryOtp';
import { createPatient, listPatients, updateMemberContact } from '@/api/users';
import { listStores } from '@/api/stores';
import { useAsync } from '@/lib/useAsync';
import type {
  MemberPatient,
  Prescription,
  PrescriptionMedicineInput,
  PrescriptionMedicineStatus,
  PrescriptionStatus,
} from '@/types';

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

const DURATION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Not set' },
  { value: 'one_week', label: '1 week' },
  { value: 'fifteen_days', label: '15 days' },
  { value: 'one_month', label: '1 month' },
  { value: 'two_months', label: '2 months' },
  { value: 'three_months', label: '3 months' },
];

const RELATION_OPTIONS: { value: string; label: string }[] = [
  { value: 'self', label: 'Self' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'child', label: 'Child' },
  { value: 'parent', label: 'Parent' },
  { value: 'other', label: 'Other' },
];

/** `PrescriptionMedicineStatus` — a pharmacist-only note on each medicine
 *  line, changeable any time it's edited; never shown in the member's app. */
const STOCK_STATUS_LABEL: Record<PrescriptionMedicineStatus, string> = {
  available: 'Stock available',
  out_of_stock: 'Out of stock',
  ordered: 'Ordered',
  not_possible: 'Not possible',
};
const STOCK_STATUS_TONE: Record<PrescriptionMedicineStatus, Tone> = {
  available: 'green',
  out_of_stock: 'amber',
  ordered: 'blue',
  not_possible: 'red',
};
const STOCK_STATUS_OPTIONS = (
  Object.keys(STOCK_STATUS_LABEL) as PrescriptionMedicineStatus[]
).map((value) => ({ value, label: STOCK_STATUS_LABEL[value] }));

const EMPTY_ROW: PrescriptionMedicineInput = {
  name: '',
  pack: '',
  intake: '',
  totalUnits: 0,
  routeTime: '',
  status: 'available',
};

const STATUS_LABEL: Record<PrescriptionStatus, string> = {
  awaiting_review: 'Awaiting review',
  read: 'Read',
  in_cart: 'In cart',
  ordered: 'Ordered',
};

/**
 * The counter's view of one uploaded script: the image, its details, and the
 * intake card editor — read the pack, dose and count off the script and send
 * it, which is what lets the customer's app expand their prescription card.
 *
 * Shared between the app-wide Prescriptions queue and the "Prescriptions" tab
 * on a member's own user page, so a script reviewed from either place goes
 * through the exact same form.
 */
export function PrescriptionReviewModal({
  prescription,
  onClose,
  onSaved,
}: {
  /** The prescription open in the modal. Null closes it. */
  prescription: Prescription | null;
  onClose: () => void;
  /** Called after a successful save, so the caller's list re-reads the row. */
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<PrescriptionMedicineInput[]>([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  // Which of this prescription's photos is on screen — a script is often
  // more than one page (migration 0040), shown one at a time with a
  // thumbnail strip to switch between them when there's more than one.
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // Every branch, for the "Branch" dropdown on the Details step.
  const { data: storeRows } = useAsync(listStores, []);
  const stores = storeRows ?? [];

  // One section at a time rather than one long scroll through both: the
  // intake card first, against the uploaded script held in view alongside
  // it; the prescription's own details second, once the script itself is
  // no longer needed on screen -- that step is the details form alone,
  // full width. "Next" / "Back" move between them.
  const [step, setStep] = useState<'intake' | 'details' | 'bill'>('intake');
  // Whether the intake card is showing as one grouped-by-status list rather
  // than plain entry order — off until "Process" is pressed, once every
  // row's stock status has been set, so lines needing the same follow-up
  // (e.g. every out-of-stock line) sit together under one heading instead
  // of scattered through the list in whatever order they were typed.
  const [processed, setProcessed] = useState(false);
  // What the member sent up front, editable here: blank/wrong doctor names
  // and durations are exactly what a reviewer corrects while reading the
  // actual script. durationToken is the raw app.medicine_duration value;
  // customDays overrides it when > 0 (see Prescription.duration's own doc).
  const [doctor, setDoctor] = useState('');
  const [durationToken, setDurationToken] = useState('');
  const [customDays, setCustomDays] = useState(0);
  // Member name/phone are the account's own — editing these here writes
  // straight to that row (see updateMemberContact), so the fix shows up
  // everywhere they're named, not just on this prescription. Branch is a
  // direct override of which store this script is filled at. Patient is a
  // pick among that same member's saved patients (or a freshly added one),
  // not free text — see patientId / patients below.
  const [memberName, setMemberName] = useState('');
  const [memberPhone, setMemberPhone] = useState('');
  const [patientId, setPatientId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // The "Send bill" panel — prices this prescription's linked order into a
  // real invoice. Seeded one row per intake medicine (qty from totalUnits,
  // price starts blank); freeform extra lines (consultation, delivery, …)
  // can be added alongside. 'summary' shows what was already sent, when
  // there is one; 'edit' is the row editor, entered either fresh (nothing
  // sent yet) or via "Edit bill" on an existing one.
  type BillLineDraft = { name: string; pack: string; unitPrice: number; qty: number };
  const [billMode, setBillMode] = useState<'summary' | 'edit'>('edit');
  const [billLines, setBillLines] = useState<BillLineDraft[]>([]);
  const [billSaving, setBillSaving] = useState(false);
  const [billSendError, setBillSendError] = useState<string | null>(null);

  // "Collect bill" — OTP-gated, same mechanism `BillEditorModal` uses
  // (see that file's own doc): the member reads back a code Firebase texted
  // them, and only once that checks out does collectBillWithWallet actually
  // move money. Its own state, separate from the pricing editor above —
  // pricing and collecting are two different moments, often on different
  // visits to this step.
  const [collectConfirmation, setCollectConfirmation] =
    useState<ConfirmationResult | null>(null);
  const [collectOtpCode, setCollectOtpCode] = useState('');
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collected, setCollected] =
    useState<{ walletAmount: number; cashAmount: number } | null>(null);

  // "Complete order" — separate again from payment collection: a bill can
  // be fully paid and still be missing a medicine nobody's billed for yet
  // (out of stock, on order). Completing stays a reviewer's own explicit
  // call, never an automatic side effect of collecting payment.
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // Every patient this member has saved (self, family, …), for the Patient
  // picker — reloaded whenever a different prescription (so a different
  // member) is open. A patient added inline from the "+" below is merged in
  // locally so it shows selected right away, without waiting on a refetch.
  const { data: patientRows, reload: reloadPatients } = useAsync(
    () => (prescription ? listPatients(prescription.memberId) : Promise.resolve([])),
    [prescription?.memberId],
  );

  // The member's live wallet balance, for the Bill step's wallet/cash
  // breakdown below — fetched once per member, re-usable across edits to the
  // bill lines since only the total (not the balance) changes as those are
  // typed.
  const { data: walletBalance } = useAsync(
    () =>
      prescription ? getWalletBalanceForMember(prescription.memberId) : Promise.resolve(0),
    [prescription?.memberId],
  );
  const [addedPatients, setAddedPatients] = useState<MemberPatient[]>([]);
  const patients = [...(patientRows ?? []), ...addedPatients];

  // The inline "add a new patient" form under the Patient picker's "+".
  const [addingPatient, setAddingPatient] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientRelation, setNewPatientRelation] = useState('self');
  const [newPatientDob, setNewPatientDob] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [savingPatient, setSavingPatient] = useState(false);
  const [newPatientError, setNewPatientError] = useState<string | null>(null);

  /** Adds a new patient under this member's account and selects it right
   *  away — the form's own error state, not the whole Details step's,
   *  because this is a small aside a reviewer can back out of without
   *  losing whatever else they'd already typed on the Details step. */
  async function confirmNewPatient() {
    if (!prescription) return;
    if (!newPatientName.trim()) {
      setNewPatientError('Give the patient a name.');
      return;
    }
    if (!newPatientDob) {
      setNewPatientError('Give the patient a date of birth.');
      return;
    }
    setSavingPatient(true);
    setNewPatientError(null);
    try {
      const created = await createPatient(prescription.memberId, {
        name: newPatientName,
        relation: newPatientRelation,
        dob: newPatientDob,
        phone: newPatientPhone,
      });
      setAddedPatients((p) => [...p, created]);
      setPatientId(created.id);
      reloadPatients();
      setAddingPatient(false);
      setNewPatientName('');
      setNewPatientRelation('self');
      setNewPatientDob('');
      setNewPatientPhone('');
    } catch (err) {
      setNewPatientError(
        err instanceof Error ? err.message : 'Could not add this patient.',
      );
    } finally {
      setSavingPatient(false);
    }
  }

  // Degrees clockwise, one of 0/90/180/270, per image id — a script
  // photographed sideways or upside down is common enough to need fixing,
  // and independently per page since only one may need it. Starts from
  // whatever was last saved for each image (app.prescription_image.
  // image_rotation), and every further rotation is saved the same way —
  // the fix is permanent, not just for this one look.
  const [rotations, setRotations] = useState<Record<string, number>>({});
  const [rotating, setRotating] = useState(false);

  // "Type" dropdown options: the built-in list plus whatever a reviewer has
  // added before on this browser (see medicineTypes.ts).
  const [customTypes, setCustomTypes] = useState<string[]>(() =>
    loadCustomMedicineTypes(),
  );
  const typeOptions = useMemo(
    () => [...MEDICINE_TYPES, ...customTypes],
    [customTypes],
  );
  // Which draft row (if any) has its "+ new type" input open, and what's
  // typed into it so far.
  const [addingTypeFor, setAddingTypeFor] = useState<number | null>(null);
  const [newTypeValue, setNewTypeValue] = useState('');

  function confirmNewType(i: number) {
    const trimmed = newTypeValue.trim();
    setAddingTypeFor(null);
    setNewTypeValue('');
    if (!trimmed) return;
    setCustomTypes(addCustomMedicineType(trimmed));
    patchRow(i, { pack: trimmed });
  }

  // Dosing-frequency presets (OD/BD/TDS/HS/q4h/…) — same idea as Type, but
  // Intake's three digits can't say "four times daily" or "every 6 hours",
  // so picking one of those fills Route & time instead; see
  // intakeFrequencies.ts's own doc for why.
  const [customFrequencies, setCustomFrequencies] = useState<
    FrequencyPreset[]
  >(() => loadCustomFrequencies());
  const frequencyOptions = useMemo(
    () => [...INTAKE_FREQUENCIES, ...customFrequencies],
    [customFrequencies],
  );
  const [addingFrequencyFor, setAddingFrequencyFor] = useState<number | null>(
    null,
  );
  const [newFrequencyValue, setNewFrequencyValue] = useState('');
  // The preset code last picked for each row, purely so the dropdown keeps
  // showing it instead of snapping back to the placeholder -- applying one
  // overwrites row.intake, which isn't a field this dropdown can read back
  // its own selection from.
  const [selectedFrequency, setSelectedFrequency] = useState<
    Record<number, string>
  >({});

  /** Sets row [i]'s Intake from a preset -- and only Intake. Every entry in
   *  frequencyOptions carries an intakeCode (see intakeFrequencies.ts); a
   *  frequency that doesn't fit Intake's three-slot shape lives in Route &
   *  time's own preset list instead, never here. */
  function applyFrequency(i: number, preset: FrequencyPreset) {
    if (preset.intakeCode) {
      patchRow(i, { intake: preset.intakeCode });
    }
  }

  function confirmNewFrequency(i: number) {
    const trimmed = newFrequencyValue.trim();
    setAddingFrequencyFor(null);
    setNewFrequencyValue('');
    if (!trimmed) return;
    const updated = addCustomFrequency(trimmed, '');
    setCustomFrequencies(updated);
    setSelectedFrequency((m) => ({ ...m, [i]: trimmed }));
    applyFrequency(i, { code: trimmed, description: '', intakeCode: trimmed });
  }

  // "Route & time" dropdown options: the standard shorthand (SL, IV, SOS, …)
  // plus whatever a reviewer has added before on this browser — same idea
  // and pattern as Type above.
  const [customRouteTimes, setCustomRouteTimes] = useState<
    { code: string; description: string }[]
  >(() => loadCustomRouteTimes());
  const routeTimeOptions = useMemo(
    () => [...ROUTE_TIME_PRESETS, ...customRouteTimes],
    [customRouteTimes],
  );
  const [addingRouteTimeFor, setAddingRouteTimeFor] = useState<number | null>(
    null,
  );
  const [newRouteTimeValue, setNewRouteTimeValue] = useState('');

  // Which route code the "Route & time" dropdown shows as picked, per row —
  // tracked separately from row.routeTime because a drop route's actual
  // stored value is the composed "OD (2 drops)" string, which doesn't match
  // any option's own value, so the dropdown couldn't otherwise tell it was
  // still "OD" that got picked. Every non-drop route stores its bare code
  // directly in row.routeTime, so this only ever diverges from it for the
  // six drop routes.
  const [selectedRouteCode, setSelectedRouteCode] = useState<
    Record<number, string>
  >({});
  // The drop count last picked per row — defaults to 1 the first time a
  // drop route is chosen, same as picking a route always yields *some*
  // valid, complete instruction rather than one silently missing its count.
  const [dropCount, setDropCount] = useState<Record<number, number>>({});

  /** Applies a Route & time pick. A drop route composes in the row's current
   *  (or default) drop count immediately — the six of these must never save
   *  as just the bare code with no count, which is the exact gap this
   *  replaces. */
  function applyRouteTime(i: number, code: string) {
    setSelectedRouteCode((m) => ({ ...m, [i]: code }));
    if (isDropRouteCode(code)) {
      const drops = dropCount[i] ?? 1;
      setDropCount((m) => ({ ...m, [i]: drops }));
      patchRow(i, { routeTime: composeDropRoute(code, drops) });
    } else {
      patchRow(i, { routeTime: code });
    }
  }

  /** Re-composes row [i]'s Route & time when its drop count changes — only
   *  reachable while a drop route is actually selected for that row. */
  function applyDropCount(i: number, drops: number) {
    setDropCount((m) => ({ ...m, [i]: drops }));
    const code = selectedRouteCode[i];
    if (code && isDropRouteCode(code)) {
      patchRow(i, { routeTime: composeDropRoute(code, drops) });
    }
  }

  function confirmNewRouteTime(i: number) {
    const trimmed = newRouteTimeValue.trim();
    setAddingRouteTimeFor(null);
    setNewRouteTimeValue('');
    if (!trimmed) return;
    setCustomRouteTimes(addCustomRouteTime(trimmed, ''));
    setSelectedRouteCode((m) => ({ ...m, [i]: trimmed }));
    patchRow(i, { routeTime: trimmed });
  }

  // Load the open prescription's existing lines into the editor (or one blank
  // row to start from).
  useEffect(() => {
    setSelectedFrequency({});
    setDetailsError(null);
    setAddedPatients([]);
    setAddingPatient(false);
    setNewPatientError(null);
    setBillSendError(null);
    setCollectConfirmation(null);
    setCollectOtpCode('');
    setCollectError(null);
    setCollected(null);
    setCompleteError(null);
    if (!prescription) {
      setSelectedRouteCode({});
      setDropCount({});
      setDraft([]);
      setImageOpen(false);
      setRotations({});
      setSelectedImageIndex(0);
      setStep('intake');
      setProcessed(false);
      setDoctor('');
      setDurationToken('');
      setCustomDays(0);
      setMemberName('');
      setMemberPhone('');
      setPatientId('');
      setStoreId('');
      setBillLines([]);
      setBillMode('edit');
      return;
    }
    setDraft(
      prescription.medicines.length > 0
        ? prescription.medicines.map((m) => ({
            name: m.name,
            pack: m.pack,
            intake: `${m.doseMorning}${m.doseAfternoon}${m.doseNight}`,
            totalUnits: m.totalUnits,
            routeTime: m.routeTime,
            status: m.status,
          }))
        : [{ ...EMPTY_ROW }],
    );
    // Re-derive the two Route & time pickers' own selections from each
    // line's saved value — a drop route's composed "OD (2 drops)" string
    // parses back into both; anything else (a plain preset code, or a
    // reviewer's earlier free-text custom entry) is left for
    // selectedRouteCode to fall back to row.routeTime directly.
    const routeCodes: Record<number, string> = {};
    const drops: Record<number, number> = {};
    prescription.medicines.forEach((m, i) => {
      const parsed = parseDropRoute(m.routeTime);
      if (parsed) {
        routeCodes[i] = parsed.code;
        drops[i] = parsed.drops;
      }
    });
    setSelectedRouteCode(routeCodes);
    setDropCount(drops);
    setRotations(Object.fromEntries(prescription.images.map((img) => [img.id, img.rotation])));
    setSelectedImageIndex(0);
    setStep('intake');
    setProcessed(false);
    setDoctor(prescription.doctor);
    setDurationToken(prescription.durationToken);
    setCustomDays(prescription.customDays);
    setMemberName(prescription.memberName);
    setMemberPhone(prescription.memberPhone);
    setPatientId(prescription.patientId);
    setStoreId(prescription.storeId);
    setBillLines(
      prescription.medicines.length > 0
        ? prescription.medicines.map((m) => ({
            name: m.name,
            pack: m.pack,
            unitPrice: 0,
            qty: m.totalUnits || 1,
          }))
        : [{ name: '', pack: '', unitPrice: 0, qty: 1 }],
    );
    setBillMode(prescription.billAmount > 0 ? 'summary' : 'edit');
    // Only when the open prescription changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prescription?.id]);

  function patchRow(i: number, patch: Partial<PrescriptionMedicineInput>) {
    setDraft((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  /** Drops row [i] and shifts the preset-dropdown selections above it down
   *  by one index, so removing a row from the middle doesn't leave a later
   *  row's dropdown showing a preset that was actually picked for a
   *  different line. */
  function removeRow(i: number) {
    setDraft((d) => d.filter((_, j) => j !== i));
    function reindex<T>(m: Record<number, T>): Record<number, T> {
      const next: Record<number, T> = {};
      for (const [k, v] of Object.entries(m)) {
        const idx = Number(k);
        if (idx < i) next[idx] = v;
        else if (idx > i) next[idx - 1] = v;
      }
      return next;
    }
    setSelectedFrequency(reindex);
    setSelectedRouteCode(reindex);
    setDropCount(reindex);
  }

  /** Adds a blank row at the top of the intake card rather than the bottom —
   *  a reviewer working down a script adds each next medicine right where
   *  they're already looking, instead of it landing off-screen below
   *  whatever's already been filled in. Every existing row shifts down one
   *  index, so the preset-dropdown selections keyed by index have to shift
   *  with them, same as removeRow's own reindex the other way. */
  function addRow() {
    setDraft((d) => [{ ...EMPTY_ROW }, ...d]);
    function reindex<T>(m: Record<number, T>): Record<number, T> {
      const next: Record<number, T> = {};
      for (const [k, v] of Object.entries(m)) {
        next[Number(k) + 1] = v;
      }
      return next;
    }
    setSelectedFrequency(reindex);
    setSelectedRouteCode(reindex);
    setDropCount(reindex);
  }

  /** Rotates the selected image by [delta] degrees and saves it immediately
   *  — a reviewer rotating a sideways script fixes it for good, not just
   *  for this look, so there is no separate "save rotation" step to
   *  forget. Only the image currently on screen is touched — the others on
   *  a multi-page script keep whatever rotation they already had. */
  async function rotateImage(delta: 90 | -90) {
    const image = prescription?.images[selectedImageIndex];
    if (!image) return;
    const current = rotations[image.id] ?? image.rotation;
    const next = (((current + delta) % 360) + 360) % 360;
    setRotations((r) => ({ ...r, [image.id]: next }));
    setRotating(true);
    try {
      await setPrescriptionImageRotation(image.id, next as 0 | 90 | 180 | 270);
    } finally {
      setRotating(false);
    }
  }

  /** The member name/phone/patient checks both {@link sendIntake} and
   *  {@link placeOrder} need before writing anything — split out so
   *  "Place order" (reachable straight from the Intake step) can catch a
   *  gap here and send the reviewer to the Details step to fill it,
   *  instead of failing silently on a step that isn't even on screen. */
  function validateDetails(): boolean {
    if (!prescription) return false;
    if (!memberName.trim() || !memberPhone.trim()) {
      setDetailsError('Member name and phone cannot be blank.');
      return false;
    }
    if (!patientId) {
      setDetailsError('Pick which patient this prescription is for.');
      return false;
    }
    return true;
  }

  /** Saves every correction on the Details step — the member's own
   *  name/phone, which patient this is for, the pinned branch, and the
   *  doctor/duration — alongside the intake card, in one go. Assumes
   *  {@link validateDetails} has already passed; returns whether it
   *  actually wrote. Shared by {@link sendIntake} (closes the modal after)
   *  and {@link placeOrder} (moves on to the Bill step instead). */
  async function saveDetailsAndIntake(): Promise<boolean> {
    if (!prescription) return false;
    setSending(true);
    setDetailsError(null);
    try {
      // The member's account fields are shared with every other order,
      // wallet entry and script on it — check the phone isn't already
      // someone else's before writing anything else.
      const contactSaved = await updateMemberContact(prescription.memberId, {
        name: memberName,
        phone: memberPhone,
      });
      if (!contactSaved) {
        setDetailsError(
          `${memberPhone.trim()} is already used by a different account — pick a different number.`,
        );
        return false;
      }
      await updatePrescriptionPatient(prescription.id, patientId);
      await updatePrescriptionBranch(prescription.id, storeId || null);
      await updatePrescriptionDetails(prescription.id, {
        doctor,
        durationToken,
        customDays,
      });
      await savePrescriptionIntake(prescription.id, draft);
      return true;
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : 'Could not save these details.',
      );
      return false;
    } finally {
      setSending(false);
    }
  }

  /** The Details step's own final action: saves everything, then closes. */
  async function sendIntake() {
    if (!validateDetails()) return;
    if (await saveDetailsAndIntake()) {
      onSaved();
      onClose();
    }
  }

  /** "Place order →", reachable from the Intake step once the medicines are
   *  processed — the fast path step 4 of this flow calls for: skip the
   *  Details step entirely when the member/patient info already on file is
   *  complete (the common case — it's pre-filled from the account), save
   *  everything the same way {@link sendIntake} does, and land straight on
   *  the Bill step instead of closing. Only falls back to actually showing
   *  the Details step when something on it needs a reviewer's attention
   *  first (a blank contact field, no patient picked, or the save itself
   *  failing) — the modal stays open either way, never closes on this path. */
  async function placeOrder() {
    if (!validateDetails()) {
      setStep('details');
      return;
    }
    if (await saveDetailsAndIntake()) {
      onSaved();
      setStep('bill');
    } else {
      setStep('details');
    }
  }

  async function changeStatus(next: PrescriptionStatus) {
    if (!prescription) return;
    setSaving(true);
    try {
      await setPrescriptionStatus(prescription.id, next);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const draftHasRows = draft.some((r) => r.name.trim().length > 0);

  // The order the intake cards render in: plain entry order until
  // "Process" is pressed, then grouped by stock status (available first,
  // then out-of-stock, ordered, not-possible — STOCK_STATUS_OPTIONS' own
  // order), each group's rows keeping their original relative order (a
  // stable sort). Holds original draft indices, not rows themselves, so
  // every existing per-row handler (patchRow(i, …), removeRow(i), the
  // preset dropdowns keyed by index) keeps working unchanged underneath.
  const statusRank = useMemo(
    () =>
      Object.fromEntries(
        STOCK_STATUS_OPTIONS.map((o, rank) => [o.value, rank]),
      ) as Record<PrescriptionMedicineStatus, number>,
    [],
  );
  const displayOrder = useMemo(() => {
    const indices = draft.map((_, i) => i);
    if (!processed) return indices;
    return [...indices].sort(
      (a, b) => statusRank[draft[a].status] - statusRank[draft[b].status],
    );
  }, [draft, processed, statusRank]);

  // Can this prescription's order be billed at all -- the same "at least
  // read" gate that unlocks the Bill nav button in the footer, and a linked
  // order to actually invoice against.
  const canBill = Boolean(
    prescription && prescription.status !== 'awaiting_review',
  );

  function patchBillLine(i: number, patch: Partial<BillLineDraft>) {
    setBillLines((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  function removeBillLine(i: number) {
    setBillLines((rows) => rows.filter((_, j) => j !== i));
  }

  // Blank-named rows are dropped before totalling/sending, same convention
  // as the intake card's own draft rows.
  const billLinesToSend = useMemo(
    () =>
      billLines
        .map((l) => ({ ...l, name: l.name.trim() }))
        .filter((l) => l.name.length > 0),
    [billLines],
  );
  const billTotal = useMemo(
    () => billLinesToSend.reduce((sum, l) => sum + l.unitPrice * l.qty, 0),
    [billLinesToSend],
  );

  // The step 5 validation: how much of this bill the wallet can actually
  // cover right now, and what's left for cash-in-hand — the exact
  // `LEAST(balance, amount)` split `collectBillWithWallet` performs, shown
  // ahead of time so a reviewer knows what to expect (and what to ask the
  // member for in cash) before they ever send the OTP.
  const walletCoverage = Math.min(walletBalance ?? 0, billTotal);
  const cashOwed = Math.max(billTotal - walletCoverage, 0);

  /** Prices this prescription's linked order and sends it — the upsert on
   *  `app.bill` (+ its `app.bill_line` rows) the member's own order screen
   *  then reads as a real, payable invoice. Stays on the Bill step in
   *  'summary' mode afterwards rather than closing — collecting payment and
   *  completing the order both happen right here, on the same step, once
   *  the bill itself is sent. */
  async function submitBill() {
    if (!prescription || !prescription.orderId) return;
    setBillSaving(true);
    setBillSendError(null);
    try {
      await sendOrderInvoice(prescription.orderId, {
        amount: billTotal,
        lines: billLinesToSend,
      });
      onSaved();
      setBillMode('summary');
    } catch (err) {
      setBillSendError(
        err instanceof Error ? err.message : 'Could not send this bill.',
      );
    } finally {
      setBillSaving(false);
    }
  }

  // Every prescribed medicine the counter is actually expected to supply --
  // everything except a line the reviewer has marked "Not possible" (that
  // one is never going to be billed, so it can't be the reason completion
  // stays blocked). Compared against the bill's own line names rather than
  // prescription.medicines: draft is this session's own up-to-date list,
  // not dependent on the parent's reload landing before this reads it.
  const billableMedicineNames = useMemo(
    () =>
      draft
        .filter((m) => m.name.trim() && m.status !== 'not_possible')
        .map((m) => m.name.trim().toLowerCase()),
    [draft],
  );
  const billedMedicineNames = useMemo(
    () => new Set(billLinesToSend.map((l) => l.name.toLowerCase())),
    [billLinesToSend],
  );
  const unbilledMedicineCount = useMemo(
    () => billableMedicineNames.filter((n) => !billedMedicineNames.has(n)).length,
    [billableMedicineNames, billedMedicineNames],
  );
  const fullyBilled =
    billableMedicineNames.length > 0 && unbilledMedicineCount === 0;

  // Whichever lands first: the prop's own billStatus (once the parent has
  // reloaded after collectBillWithWallet, or on reopening an already-paid
  // prescription) or this session's own `collected` result, set the moment
  // collection succeeds and before that reload has necessarily landed.
  const billIsPaid = collected !== null || prescription?.billStatus === 'paid';

  const recaptchaContainerId = prescription
    ? `rx-bill-otp-recaptcha-${prescription.id}`
    : 'rx-bill-otp-recaptcha';

  async function sendCollectOtp() {
    if (!prescription) return;
    setCollectBusy(true);
    setCollectError(null);
    try {
      const confirmation = await sendDeliveryOtp(
        prescription.memberPhone,
        recaptchaContainerId,
      );
      setCollectConfirmation(confirmation);
    } catch (err) {
      setCollectError(describeOtpError(err));
    } finally {
      setCollectBusy(false);
    }
  }

  /** Only reachable once the member's own code has checked out — see
   *  `collectBillWithWallet`'s own doc for exactly how the wallet/cash
   *  split it performs works. */
  async function verifyAndCollectBill() {
    if (!prescription || !prescription.orderId) return;
    if (!collectConfirmation || collectOtpCode.trim().length === 0) return;
    setCollectBusy(true);
    setCollectError(null);
    try {
      await confirmDeliveryOtp(collectConfirmation, collectOtpCode);
      const result = await collectBillWithWallet(prescription.orderId);
      if (!result.ok) {
        setCollectError(result.reason);
        return;
      }
      setCollected({ walletAmount: result.walletAmount, cashAmount: result.cashAmount });
      setCollectConfirmation(null);
      setCollectOtpCode('');
      onSaved();
    } catch (err) {
      setCollectError(describeOtpError(err));
    } finally {
      setCollectBusy(false);
    }
  }

  /** Step 7 of this flow: closing out the order is always this explicit
   *  click, never a side effect of sending or paying the bill — and it's
   *  blocked while any medicine that's actually expected (i.e. not marked
   *  "Not possible") is still missing from the bill, so a partially-filled
   *  script can't accidentally read as finished. */
  async function completeOrder() {
    if (!prescription || !prescription.orderId) return;
    if (!fullyBilled || !billIsPaid) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      await setOrderStatus(prescription.orderId, 'delivered');
      onSaved();
      onClose();
    } catch (err) {
      setCompleteError(
        err instanceof Error ? err.message : 'Could not complete this order.',
      );
    } finally {
      setCompleting(false);
    }
  }

  return (
    <>
      <Modal
        open={Boolean(prescription)}
        onClose={onClose}
        size="xl"
        title={prescription ? prescription.code : ''}
        footer={
          prescription &&
          (step === 'intake' ? (
            <>
              {prescription.status !== 'awaiting_review' && (
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => changeStatus('awaiting_review')}
                >
                  Back to awaiting
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={!draftHasRows}
                onClick={() => setStep('details')}
              >
                Next: Details →
              </Button>
              <Button
                variant="primary"
                disabled={!draftHasRows || !processed || sending}
                title={
                  !processed
                    ? 'Click "Process" above to group the medicines by status first'
                    : undefined
                }
                onClick={() => void placeOrder()}
              >
                {sending ? 'Placing order…' : 'Place order →'}
              </Button>
            </>
          ) : step === 'details' ? (
            <>
              <Button
                variant="secondary"
                disabled={sending}
                onClick={() => setStep('intake')}
              >
                ← Back to intake card
              </Button>
              {prescription.status !== 'awaiting_review' && (
                <Button
                  variant="secondary"
                  disabled={saving || sending}
                  onClick={() => changeStatus('awaiting_review')}
                >
                  Back to awaiting
                </Button>
              )}
              {canBill && (
                <Button
                  variant="secondary"
                  disabled={sending}
                  onClick={() => setStep('bill')}
                >
                  Price & send bill →
                </Button>
              )}
              <Button variant="primary" disabled={sending} onClick={sendIntake}>
                {sending
                  ? 'Sending…'
                  : prescription.medicines.length > 0
                    ? 'Update intake card'
                    : 'Send intake card'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={billSaving}
                onClick={() => setStep('details')}
              >
                ← Back to details
              </Button>
              {billMode === 'edit' && (
                <Button
                  variant="primary"
                  disabled={billSaving || !prescription.orderId}
                  onClick={submitBill}
                >
                  {billSaving
                    ? 'Sending…'
                    : prescription.billAmount > 0
                      ? 'Update bill'
                      : 'Send bill'}
                </Button>
              )}
              {billMode === 'summary' && (
                <Button
                  variant="primary"
                  disabled={completing || !fullyBilled || !billIsPaid}
                  title={
                    !fullyBilled
                      ? `${unbilledMedicineCount} medicine${unbilledMedicineCount === 1 ? '' : 's'} still not on the bill`
                      : !billIsPaid
                        ? 'Collect the bill before completing the order'
                        : undefined
                  }
                  onClick={() => void completeOrder()}
                >
                  {completing ? 'Completing…' : 'Complete order'}
                </Button>
              )}
            </>
          ))
        }
      >
        {prescription && (
          <div
            className={
              step === 'intake'
                ? 'grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]'
                : 'mx-auto max-w-lg'
            }
          >
            {/* The intake card sits against the uploaded script, held in
                view alongside it; the prescription's own details come
                after, as a plain form -- the script is no longer needed on
                screen by then. */}
            <div className={step === 'intake' ? 'order-2 md:order-1' : ''}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge tone={toneForStatus(prescription.status)}>
                    {STATUS_LABEL[prescription.status]}
                  </Badge>
                  {/* Store pickup vs home delivery — the same fact Orders
                      shows on every order, surfaced here too since a
                      prescription's fulfilment decides whether the counter
                      hands the script over in person or a delivery boy takes
                      it out. */}
                  <Badge tone={prescription.fulfillmentType === 'home_delivery' ? 'blue' : 'gray'}>
                    <Icon
                      name={prescription.fulfillmentType === 'home_delivery' ? 'deliveries' : 'stores'}
                      className="h-3 w-3"
                    />
                    {prescription.fulfillmentType === 'home_delivery' ? 'Home Delivery' : 'Store Pickup'}
                  </Badge>
                </div>
                <span className="text-xs font-medium text-slate-400">
                  {step === 'intake'
                    ? canBill
                      ? '1 of 3 · Intake card'
                      : '1 of 2 · Intake card'
                    : step === 'details'
                      ? canBill
                        ? '2 of 3 · Details'
                        : '2 of 2 · Details'
                      : '3 of 3 · Billing'}
                </span>
              </div>

              {step === 'intake' ? (
              <div>
                <p className="mb-3 text-xs text-slate-400">
                  {prescription.memberName} · {prescription.patientName}
                </p>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Intake card
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={!draftHasRows}
                      title={
                        processed
                          ? 'Show the medicines in plain entry order again'
                          : "Group the medicines below by stock status once every row's status is set"
                      }
                      className="text-xs font-medium text-brand-600 disabled:cursor-not-allowed disabled:text-slate-300"
                      onClick={() => setProcessed((p) => !p)}
                    >
                      {processed ? '← Unprocess' : 'Process ✓'}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-600"
                      onClick={addRow}
                    >
                      + Add medicine
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-xs text-slate-400">
                  Pick an Intake preset below for how often each medicine is
                  taken — it fills in the three-digit morning-afternoon-night
                  code the customer's app expands when you send this.
                </p>
                <div className="space-y-2">
                  {displayOrder.map((i, pos) => {
                    const row = draft[i];
                    const groupStart =
                      processed &&
                      (pos === 0 ||
                        draft[displayOrder[pos - 1]].status !== row.status);
                    return (
                    <div key={i}>
                      {groupStart && (
                        <div
                          className={`mb-1.5 flex items-center gap-2 ${pos === 0 ? '' : 'mt-3'}`}
                        >
                          <Badge tone={STOCK_STATUS_TONE[row.status]}>
                            {STOCK_STATUS_LABEL[row.status]}
                          </Badge>
                          <span className="text-xs font-medium text-slate-400">
                            {
                              displayOrder.filter(
                                (j) => draft[j].status === row.status,
                              ).length
                            }{' '}
                            medicine
                            {displayOrder.filter(
                              (j) => draft[j].status === row.status,
                            ).length === 1
                              ? ''
                              : 's'}
                          </span>
                        </div>
                      )}
                    <div
                      className="rounded-lg border border-blue-700 bg-blue-600 p-3 text-white"
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-blue-100">
                          Medicine {i + 1}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-200 hover:text-rose-100"
                          onClick={() => removeRow(i)}
                        >
                          Remove
                        </button>
                      </div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-blue-100">
                        Name
                      </p>
                      <input
                        value={row.name}
                        onChange={(e) => patchRow(i, { name: e.target.value })}
                        placeholder="e.g. Paracetamol 500mg"
                        className={inputClass}
                      />
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-blue-100">
                        Type
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Combobox
                          value={row.pack}
                          onChange={(v) => patchRow(i, { pack: v })}
                          options={typeOptions.map((t) => ({ value: t, label: t }))}
                          placeholder="Choose a type"
                          searchPlaceholder="Search types…"
                          className="flex-1"
                        />
                        <button
                          type="button"
                          title="Add a new type"
                          onClick={() => {
                            setAddingTypeFor(i);
                            setNewTypeValue('');
                          }}
                          className="shrink-0 rounded-md border border-white/40 bg-white p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                        >
                          <Icon name="plus" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {addingTypeFor === i && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={newTypeValue}
                            onChange={(e) => setNewTypeValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                confirmNewType(i);
                              } else if (e.key === 'Escape') {
                                setAddingTypeFor(null);
                              }
                            }}
                            placeholder="New type name"
                            className={inputClass}
                          />
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => confirmNewType(i)}
                          >
                            Add
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-white hover:bg-white/10"
                            onClick={() => setAddingTypeFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-blue-100">
                        Quantity
                      </p>
                      <input
                        value={row.totalUnits || ''}
                        onChange={(e) =>
                          patchRow(i, {
                            totalUnits: Number(e.target.value) || 0,
                          })
                        }
                        placeholder="Number of units"
                        inputMode="numeric"
                        className={inputClass}
                      />
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-blue-100">
                        Intake preset
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Combobox
                          value={selectedFrequency[i] ?? ''}
                          onChange={(v) => {
                            setSelectedFrequency((m) => ({ ...m, [i]: v }));
                            const preset = frequencyOptions.find(
                              (f) => f.code === v,
                            );
                            if (preset) applyFrequency(i, preset);
                          }}
                          options={frequencyOptions.map((f) => ({
                            value: f.code,
                            label: f.description
                              ? `${f.code} — ${f.description}`
                              : f.code,
                          }))}
                          placeholder="OD, BD, TDS, …"
                          searchPlaceholder="Search intake presets…"
                          className="flex-1"
                        />
                        <button
                          type="button"
                          title="Add a new intake preset"
                          onClick={() => {
                            setAddingFrequencyFor(i);
                            setNewFrequencyValue('');
                          }}
                          className="shrink-0 rounded-md border border-white/40 bg-white p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                        >
                          <Icon name="plus" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {row.intake && (
                        <p className="mt-1 text-xs text-blue-100">
                          Intake set to {row.intake.split('').join('-')} — pick
                          a different preset to change it.
                        </p>
                      )}
                      {addingFrequencyFor === i && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={newFrequencyValue}
                            onChange={(e) =>
                              setNewFrequencyValue(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                confirmNewFrequency(i);
                              } else if (e.key === 'Escape') {
                                setAddingFrequencyFor(null);
                              }
                            }}
                            placeholder="New Intake code, e.g. 1-1-1"
                            className={inputClass}
                          />
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => confirmNewFrequency(i)}
                          >
                            Add
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-white hover:bg-white/10"
                            onClick={() => setAddingFrequencyFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-blue-100">
                        Route &amp; time
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Combobox
                          value={selectedRouteCode[i] ?? row.routeTime}
                          onChange={(v) => applyRouteTime(i, v)}
                          options={routeTimeOptions.map((r) => ({
                            value: r.code,
                            label: r.description
                              ? `${r.code} — ${r.description}`
                              : r.code,
                          }))}
                          placeholder="Choose route & time"
                          searchPlaceholder="Search route & time…"
                          className="flex-1"
                        />
                        {isDropRouteCode(selectedRouteCode[i] ?? '') && (
                          <select
                            value={dropCount[i] ?? 1}
                            onChange={(e) =>
                              applyDropCount(i, Number(e.target.value))
                            }
                            title="Number of drops"
                            className={`${inputClass} w-[92px] shrink-0`}
                          >
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <option key={n} value={n}>
                                {n} drop{n === 1 ? '' : 's'}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          title="Add a new route / time"
                          onClick={() => {
                            setAddingRouteTimeFor(i);
                            setNewRouteTimeValue('');
                          }}
                          className="shrink-0 rounded-md border border-white/40 bg-white p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                        >
                          <Icon name="plus" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {addingRouteTimeFor === i && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={newRouteTimeValue}
                            onChange={(e) => setNewRouteTimeValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                confirmNewRouteTime(i);
                              } else if (e.key === 'Escape') {
                                setAddingRouteTimeFor(null);
                              }
                            }}
                            placeholder="New route/time (e.g. Oral, after food)"
                            className={inputClass}
                          />
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => confirmNewRouteTime(i)}
                          >
                            Add
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-white hover:bg-white/10"
                            onClick={() => setAddingRouteTimeFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-blue-100">
                        Stock status
                      </p>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={row.status}
                          onChange={(e) =>
                            patchRow(i, {
                              status: e.target.value as PrescriptionMedicineStatus,
                            })
                          }
                          className={`${inputClass} flex-1`}
                        >
                          {STOCK_STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <Badge tone={STOCK_STATUS_TONE[row.status]}>
                          {STOCK_STATUS_LABEL[row.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-blue-100">
                        For the counter only — never shown in the member's app.
                      </p>
                    </div>
                    </div>
                    );
                  })}
                  {draft.length === 0 && (
                    <p className="text-sm text-slate-400">
                      No lines yet — add the medicines from the script.
                    </p>
                  )}
                </div>
              </div>
              ) : step === 'details' ? (
                <>
                  <DetailList
                    rows={[
                      {
                        label: 'Member',
                        value: (
                          <input
                            value={memberName}
                            onChange={(e) => setMemberName(e.target.value)}
                            placeholder="Member's name"
                            className={inputClass}
                          />
                        ),
                      },
                      {
                        label: 'Phone',
                        value: (
                          <div className="flex items-center gap-1.5">
                            <input
                              value={memberPhone}
                              onChange={(e) => setMemberPhone(e.target.value)}
                              placeholder="10-digit phone"
                              inputMode="tel"
                              className={`${inputClass} flex-1`}
                            />
                            {/* Straight from the number on screen — including
                                a correction just typed above, not yet saved —
                                so a reviewer can call to confirm it before
                                committing to it. */}
                            <a
                              href={
                                memberPhone
                                  ? `tel:${memberPhone.replace(/\D/g, '')}`
                                  : undefined
                              }
                              title="Call this number"
                              className={`shrink-0 rounded-md border border-slate-300 p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700 ${
                                memberPhone ? '' : 'pointer-events-none opacity-40'
                              }`}
                            >
                              <Icon name="phone" className="h-3.5 w-3.5" />
                            </a>
                            <a
                              href={
                                memberPhone
                                  ? `https://wa.me/91${memberPhone.replace(/\D/g, '')}`
                                  : undefined
                              }
                              target="_blank"
                              rel="noreferrer"
                              title="Message on WhatsApp"
                              className={`shrink-0 rounded-md border border-slate-300 p-[7px] text-emerald-600 hover:bg-emerald-50 ${
                                memberPhone ? '' : 'pointer-events-none opacity-40'
                              }`}
                            >
                              <Icon name="whatsapp" className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        ),
                      },
                      {
                        label: 'Patient',
                        value: (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <Combobox
                                value={patientId}
                                onChange={setPatientId}
                                options={patients.map((p) => ({
                                  value: p.id,
                                  label: `${p.name} (${p.relation})`,
                                }))}
                                placeholder="Choose a patient"
                                searchPlaceholder="Search patients…"
                                className="flex-1"
                              />
                              <button
                                type="button"
                                title="Add a new patient"
                                onClick={() => {
                                  setAddingPatient(true);
                                  setNewPatientError(null);
                                }}
                                className="shrink-0 rounded-md border border-slate-300 p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                              >
                                <Icon name="plus" className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {addingPatient && (
                              <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-2.5">
                                <input
                                  autoFocus
                                  value={newPatientName}
                                  onChange={(e) => setNewPatientName(e.target.value)}
                                  placeholder="Patient's name"
                                  className={inputClass}
                                />
                                <div className="grid grid-cols-2 gap-1.5">
                                  <select
                                    value={newPatientRelation}
                                    onChange={(e) =>
                                      setNewPatientRelation(e.target.value)
                                    }
                                    className={inputClass}
                                  >
                                    {RELATION_OPTIONS.map((r) => (
                                      <option key={r.value} value={r.value}>
                                        {r.label}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="date"
                                    value={newPatientDob}
                                    onChange={(e) => setNewPatientDob(e.target.value)}
                                    className={inputClass}
                                  />
                                </div>
                                <input
                                  value={newPatientPhone}
                                  onChange={(e) => setNewPatientPhone(e.target.value)}
                                  placeholder="Phone (optional)"
                                  inputMode="tel"
                                  className={inputClass}
                                />
                                {newPatientError && (
                                  <p className="text-xs text-rose-600">
                                    {newPatientError}
                                  </p>
                                )}
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={savingPatient}
                                    onClick={confirmNewPatient}
                                  >
                                    {savingPatient ? 'Adding…' : 'Add patient'}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={savingPatient}
                                    onClick={() => setAddingPatient(false)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ),
                      },
                      {
                        label: 'Branch',
                        value: (
                          <select
                            value={storeId}
                            onChange={(e) => setStoreId(e.target.value)}
                            className={inputClass}
                          >
                            <option value="">
                              Not set — {prescription.storeName}
                            </option>
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
                          <Badge tone={prescription.fulfillmentType === 'home_delivery' ? 'blue' : 'gray'}>
                            <Icon
                              name={prescription.fulfillmentType === 'home_delivery' ? 'deliveries' : 'stores'}
                              className="h-3 w-3"
                            />
                            {prescription.fulfillmentType === 'home_delivery' ? 'Home Delivery' : 'Store Pickup'}
                          </Badge>
                        ),
                      },
                      {
                        label: 'Uploaded',
                        value: formatDateTime(prescription.createdAt),
                      },
                      {
                        label: 'Doctor',
                        value: (
                          <input
                            value={doctor}
                            onChange={(e) => setDoctor(e.target.value)}
                            placeholder="Read off the script"
                            className={inputClass}
                          />
                        ),
                      },
                      {
                        label: 'Duration',
                        value: (
                          <div>
                            <div className="flex items-center gap-1.5">
                              <select
                                value={durationToken}
                                onChange={(e) => setDurationToken(e.target.value)}
                                className={inputClass}
                              >
                                {DURATION_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                value={customDays || ''}
                                onChange={(e) =>
                                  setCustomDays(Number(e.target.value) || 0)
                                }
                                placeholder="Or custom days"
                                inputMode="numeric"
                                className={`${inputClass} w-32 text-right`}
                              />
                            </div>
                            <p className="mt-1 text-xs font-normal text-slate-400">
                              Custom days, when set, overrides the dropdown.
                            </p>
                          </div>
                        ),
                      },
                    ]}
                  />
                  {detailsError && (
                    <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {detailsError}
                    </p>
                  )}
                </>
              ) : (
                <div>
                  <p className="mb-3 text-xs text-slate-400">
                    {prescription.memberName} · {prescription.patientName}
                  </p>
                  {!prescription.orderId ? (
                    <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-400">
                      No linked order found — this prescription can&apos;t be
                      billed from here.
                    </p>
                  ) : billMode === 'summary' ? (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-slate-200 p-4">
                        <p className="text-sm text-slate-800">
                          Bill sent — {formatCurrency(prescription.billAmount)} (
                          {billIsPaid ? 'Paid' : 'Pending'})
                        </p>
                        <div className="mt-2">
                          {fullyBilled ? (
                            <Badge tone="green">All medicines billed</Badge>
                          ) : (
                            <Badge tone="amber">
                              {unbilledMedicineCount} medicine
                              {unbilledMedicineCount === 1 ? '' : 's'} not on the bill —
                              partially billed
                            </Badge>
                          )}
                        </div>
                        <div className="mt-3">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setBillMode('edit')}
                          >
                            Edit bill
                          </Button>
                        </div>
                      </div>

                      {!billIsPaid && (
                        <div className="rounded-lg border border-slate-200 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Collect bill
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Send a one-time code to the member&apos;s phone, then enter
                            what they read out to you. Only once that code checks out:
                            the member&apos;s wallet balance is used automatically (up
                            to the bill amount), and any shortfall is collected in cash
                            at the counter — never before the code is verified.
                          </p>
                          {billTotal > 0 && (
                            <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                              <div className="flex items-center justify-between">
                                <span>Member&apos;s wallet balance</span>
                                <span className="font-medium text-slate-800">
                                  {formatCurrency(walletBalance ?? 0)}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center justify-between">
                                <span>Will draw from wallet</span>
                                <span className="font-medium text-slate-800">
                                  {formatCurrency(walletCoverage)}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center justify-between">
                                <span>
                                  {cashOwed > 0
                                    ? 'Collect in cash, hand to hand'
                                    : 'Cash needed'}
                                </span>
                                <span
                                  className={
                                    cashOwed > 0
                                      ? 'font-semibold text-amber-700'
                                      : 'font-medium text-slate-800'
                                  }
                                >
                                  {formatCurrency(cashOwed)}
                                </span>
                              </div>
                            </div>
                          )}
                          <div id={recaptchaContainerId} />
                          {!collectConfirmation ? (
                            <Button
                              size="sm"
                              className="mt-3"
                              disabled={collectBusy}
                              onClick={() => void sendCollectOtp()}
                            >
                              {collectBusy ? 'Sending…' : 'Send OTP to member'}
                            </Button>
                          ) : (
                            <div className="mt-3 flex items-center gap-2">
                              <input
                                value={collectOtpCode}
                                onChange={(e) => setCollectOtpCode(e.target.value)}
                                placeholder="6-digit code"
                                inputMode="numeric"
                                autoFocus
                                className={inputClass}
                              />
                              <Button
                                size="sm"
                                disabled={collectBusy || collectOtpCode.trim().length === 0}
                                onClick={() => void verifyAndCollectBill()}
                              >
                                {collectBusy ? 'Verifying…' : 'Verify & collect'}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={collectBusy}
                                onClick={() => void sendCollectOtp()}
                              >
                                Resend
                              </Button>
                            </div>
                          )}
                          {collectError && (
                            <p className="mt-2 text-xs text-rose-600">{collectError}</p>
                          )}
                        </div>
                      )}

                      {collected && (
                        <p className="text-sm font-medium text-emerald-600">
                          Collected —{' '}
                          {collected.walletAmount > 0 &&
                            `${formatCurrency(collected.walletAmount)} from wallet`}
                          {collected.walletAmount > 0 && collected.cashAmount > 0 && ' + '}
                          {collected.cashAmount > 0 &&
                            `${formatCurrency(collected.cashAmount)} in cash`}
                          . This bill is paid.
                        </p>
                      )}

                      {completeError && (
                        <p className="text-xs text-rose-600">{completeError}</p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Bill lines
                        </p>
                        <button
                          type="button"
                          className="text-xs font-medium text-brand-600"
                          onClick={() =>
                            setBillLines((rows) => [
                              ...rows,
                              { name: '', pack: '', unitPrice: 0, qty: 1 },
                            ])
                          }
                        >
                          + Add line
                        </button>
                      </div>
                      <div className="space-y-2">
                        {billLines.map((line, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-slate-200 p-3"
                          >
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-xs font-medium text-slate-500">
                                Line {i + 1}
                              </span>
                              <button
                                type="button"
                                className="text-xs font-medium text-rose-600 hover:text-rose-700"
                                onClick={() => removeBillLine(i)}
                              >
                                Remove
                              </button>
                            </div>
                            <input
                              value={line.name}
                              onChange={(e) =>
                                patchBillLine(i, { name: e.target.value })
                              }
                              placeholder="Item name"
                              className={inputClass}
                            />
                            <div className="mt-2 grid grid-cols-3 gap-1.5">
                              <input
                                value={line.pack}
                                onChange={(e) =>
                                  patchBillLine(i, { pack: e.target.value })
                                }
                                placeholder="Pack"
                                className={inputClass}
                              />
                              <input
                                value={line.unitPrice || ''}
                                onChange={(e) =>
                                  patchBillLine(i, {
                                    unitPrice: Number(e.target.value) || 0,
                                  })
                                }
                                placeholder="Unit price"
                                inputMode="decimal"
                                className={inputClass}
                              />
                              <input
                                value={line.qty || ''}
                                onChange={(e) =>
                                  patchBillLine(i, {
                                    qty: Number(e.target.value) || 0,
                                  })
                                }
                                placeholder="Qty"
                                inputMode="numeric"
                                className={inputClass}
                              />
                            </div>
                          </div>
                        ))}
                        {billLines.length === 0 && (
                          <p className="text-sm text-slate-400">
                            No lines yet — add at least one.
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-800">
                        <span>Total</span>
                        <span>{formatCurrency(billTotal)}</span>
                      </div>
                      {billTotal > 0 && (
                        <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          <div className="flex items-center justify-between">
                            <span>Member&apos;s wallet balance</span>
                            <span className="font-medium text-slate-800">
                              {formatCurrency(walletBalance ?? 0)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span>From wallet</span>
                            <span className="font-medium text-slate-800">
                              {formatCurrency(walletCoverage)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span>
                              {cashOwed > 0
                                ? 'Collect in cash, hand to hand'
                                : 'Cash needed'}
                            </span>
                            <span
                              className={
                                cashOwed > 0
                                  ? 'font-semibold text-amber-700'
                                  : 'font-medium text-slate-800'
                              }
                            >
                              {formatCurrency(cashOwed)}
                            </span>
                          </div>
                        </div>
                      )}
                      {billSendError && (
                        <p className="mt-2 text-xs text-rose-600">{billSendError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right — the uploaded script, kept in view against the intake
                card; no longer needed once it's just the details form. A
                script is often more than one page (migration 0040) — a
                thumbnail strip switches between them when there's more
                than one, and only the page on screen is rotated. */}
            {step === 'intake' && (() => {
              const images = prescription.images;
              const current = images[selectedImageIndex];
              const currentRotation = current ? (rotations[current.id] ?? current.rotation) : 0;
              return (
            <div className="order-1 md:order-2 md:sticky md:top-0 md:self-start">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Uploaded script
                  {images.length > 1 && ` (${selectedImageIndex + 1} of ${images.length})`}
                </p>
                {current && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Rotate left"
                      disabled={rotating}
                      onClick={() => rotateImage(-90)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                    >
                      <Icon name="rotate" className="h-4 w-4 -scale-x-100" />
                    </button>
                    <button
                      type="button"
                      title="Rotate right"
                      disabled={rotating}
                      onClick={() => rotateImage(90)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                    >
                      <Icon name="rotate" className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              {current ? (
                <div className="flex w-full items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <button
                    type="button"
                    onClick={() => setImageOpen(true)}
                    className="block"
                  >
                    <img
                      src={current.image}
                      alt={`Prescription ${prescription.code} — page ${selectedImageIndex + 1}`}
                      className="object-contain transition-transform duration-200"
                      style={{
                        transform: `rotate(${currentRotation}deg)`,
                        // A quarter-turn swaps the image's effective footprint
                        // — capped to the sidebar's own width when on its
                        // side, rather than the taller-than-wide budget an
                        // upright script reads comfortably at.
                        maxWidth: currentRotation % 180 === 0 ? '100%' : 220,
                        maxHeight: currentRotation % 180 === 0 ? '55vh' : '100%',
                      }}
                    />
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-10 text-center text-sm text-slate-400">
                  No image was uploaded with this prescription.
                </div>
              )}
              {images.length > 1 && (
                <div className="mt-2 flex gap-1.5">
                  {images.map((img, i) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setSelectedImageIndex(i)}
                      className={`h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 ${
                        i === selectedImageIndex
                          ? 'border-brand-500'
                          : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={img.image}
                        alt={`Page ${i + 1} thumbnail`}
                        className="h-full w-full object-cover"
                        style={{ transform: `rotate(${rotations[img.id] ?? img.rotation}deg)` }}
                      />
                    </button>
                  ))}
                </div>
              )}
              {current && (
                <p className="mt-1.5 text-xs text-slate-400">
                  Tap the image to view it full size, or use the rotate
                  buttons above to fix a sideways scan for good.
                </p>
              )}
            </div>
              );
            })()}
          </div>
        )}
      </Modal>

      <Modal
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        title={
          prescription
            ? `${prescription.code} — script${
                prescription.images.length > 1
                  ? ` (${selectedImageIndex + 1} of ${prescription.images.length})`
                  : ''
              }`
            : ''
        }
        footer={
          prescription?.images[selectedImageIndex] && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={rotating}
                onClick={() => rotateImage(-90)}
              >
                <Icon name="rotate" className="h-4 w-4 -scale-x-100" />
                Rotate left
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={rotating}
                onClick={() => rotateImage(90)}
              >
                <Icon name="rotate" className="h-4 w-4" />
                Rotate right
              </Button>
            </>
          )
        }
      >
        {prescription?.images[selectedImageIndex] &&
          (() => {
            const current = prescription.images[selectedImageIndex];
            const currentRotation = rotations[current.id] ?? current.rotation;
            return (
              <div className="flex min-h-[50vh] items-center justify-center overflow-hidden">
                <img
                  src={current.image}
                  alt={`Prescription ${prescription.code} — page ${selectedImageIndex + 1}`}
                  className="object-contain transition-transform duration-200"
                  style={{
                    transform: `rotate(${currentRotation}deg)`,
                    // A quarter-turn swaps the image's effective footprint, so the
                    // side capped to the viewport has to swap too or a portrait
                    // script rotated on its side would overflow the modal width.
                    maxWidth: currentRotation % 180 === 0 ? '100%' : '70vh',
                    maxHeight: currentRotation % 180 === 0 ? '70vh' : '80vw',
                  }}
                />
              </div>
            );
          })()}
      </Modal>
    </>
  );
}
