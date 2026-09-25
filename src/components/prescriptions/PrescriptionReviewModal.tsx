import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Combobox } from '@/components/ui/Combobox';
import { DetailList } from '@/components/ui/DetailList';
import { formatCurrency, formatDateTime, toneForStatus } from '@/lib/format';
import {
  STOCK_STATUS_LABEL,
  STOCK_STATUS_OPTIONS,
  STOCK_STATUS_TONE,
} from '@/lib/prescriptionMedicine';
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
import {
  getOrder,
  markOrderConvertedToBill,
  markOrderStoreContacted,
  setOrderStatus,
} from '@/api/orders';
import { createPatient, listPatients, updateMemberContact } from '@/api/users';
import { listStores } from '@/api/stores';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/context/AuthContext';
import type {
  MemberPatient,
  Prescription,
  PrescriptionMedicineInput,
  PrescriptionMedicineStatus,
  PrescriptionStatus,
} from '@/types';

const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';
// The open entry card's own fields, tighter still — this is what actually
// shrinks the card's own height, not just a narrower column: less
// vertical room per field, not smaller text (nothing here gets harder to
// read, just closer together).
const compactInputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

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

const EMPTY_ROW: PrescriptionMedicineInput = {
  name: '',
  pack: '',
  intake: '',
  totalUnits: 0,
  routeTime: '',
  status: 'available',
};

// Display labels only — see the identical note in PrescriptionsPage.tsx.
// The underlying status values (`changeStatus('awaiting_review')` etc.
// below) are untouched.
const STATUS_LABEL: Record<PrescriptionStatus, string> = {
  awaiting_review: 'Pending',
  read: 'Processed',
  in_cart: 'Billing',
  ordered: 'Completed',
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
  const navigate = useNavigate();
  const [draft, setDraft] = useState<PrescriptionMedicineInput[]>([]);
  // Which table row's "⋮" menu (Edit / Delete) is open, if any — at most
  // one at a time, closed by picking an action or clicking anywhere else.
  const [openRowMenu, setOpenRowMenu] = useState<number | null>(null);
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
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [intakeSent, setIntakeSent] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  // Which of this prescription's photos is on screen — a script is often
  // more than one page (migration 0040), shown one at a time with a
  // thumbnail strip to switch between them when there's more than one.
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // Every branch, for the "Branch" dropdown on the Details step.
  const { accessToken } = useAuth();
  const { data: storeRows } = useAsync(() => listStores(accessToken), [accessToken]);
  const stores = storeRows ?? [];

  // One section at a time rather than one long scroll through both: the
  // intake card first, against the uploaded script held in view alongside
  // it; the prescription's own details second, once the script itself is
  // no longer needed on screen -- that step is the details form alone,
  // full width. "Next" / "Back" move between them.
  const [step, setStep] = useState<'intake' | 'details'>('intake');
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

  // "Complete order" — separate from payment collection, which now happens
  // entirely in the Bills page's `BillEditorModal`: a bill can be fully
  // paid and still be missing a medicine nobody's billed for yet (out of
  // stock, on order). Completing stays a reviewer's own explicit call,
  // never an automatic side effect of collecting payment.
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  // Stamped by the Call / WhatsApp buttons on the Details step — the linked
  // order's "Store contact" stage in the member's app. Local so it shows the
  // moment it lands; `linkedOrder` (below) supplies it on a later reopen.
  const [contactMarkedAt, setContactMarkedAt] = useState('');

  // Every patient this member has saved (self, family, …), for the Patient
  // picker — reloaded whenever a different prescription (so a different
  // member) is open. A patient added inline from the "+" below is merged in
  // locally so it shows selected right away, without waiting on a refetch.
  const { data: patientRows, reload: reloadPatients } = useAsync(
    () => (prescription ? listPatients(prescription.memberId) : Promise.resolve([])),
    [prescription?.memberId],
  );

  // The linked order's real, saved state — read back fresh rather than kept
  // from any local draft, since pricing now happens entirely on the Bills
  // page. This is what gates "Complete order" below: every billable intake
  // medicine actually has to be on the order's real bill, and that bill has
  // to be paid, before a reviewer can close the order out.
  const { data: linkedOrder } = useAsync(
    () => (prescription?.orderId ? getOrder(prescription.orderId) : Promise.resolve(null)),
    [prescription?.orderId, prescription?.billStatus, prescription?.billAmount],
  );
  const [addedPatients, setAddedPatients] = useState<MemberPatient[]>([]);
  // confirmNewPatient both appends the freshly-created patient here (so the
  // picker shows it selected immediately, without waiting on a refetch) and
  // kicks off reloadPatients() in the same breath — once that reload lands,
  // the same patient is in patientRows too, and this list showed it twice.
  // Only keep an addedPatients entry whose id patientRows doesn't already
  // have.
  const knownPatientIds = new Set((patientRows ?? []).map((p) => p.id));
  const patients = [
    ...(patientRows ?? []),
    ...addedPatients.filter((p) => !knownPatientIds.has(p.id)),
  ];

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
    setCompleteError(null);
    setContactMarkedAt('');
    setIntakeSent(false);
    if (!prescription) {
      setSelectedRouteCode({});
      setDropCount({});
      setDraft([]);
      setOpenRowMenu(null);
      setImageOpen(false);
      setRotations({});
      setSelectedImageIndex(0);
      setStep('intake');
      setDoctor('');
      setDurationToken('');
      setCustomDays(0);
      setMemberName('');
      setMemberPhone('');
      setPatientId('');
      setStoreId('');
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
    // Straight to Details (Convert to bill's own step) on reopening a
    // prescription that actually has saved medicines already — its intake
    // card was genuinely sent, in this session or an earlier one, so the
    // reviewer's next real job here is billing it, not re-reviewing
    // medicines. Keyed on medicines.length, not `status` — savePrescriptionIntake
    // only ever moves status off 'awaiting_review' when it wrote at least
    // one real row (see its own `if (rows.length > 0)` guard), so this
    // reads the same signal more directly and stays correct even in the
    // edge case where a prescription's status advanced but its medicines
    // were since cleared back to none — that one still needs the intake
    // card shown first, not an empty Convert-to-bill screen. Only starts
    // on the intake card itself for one genuinely still unsaved.
    // intakeSent mirrors the same real data rather than staying false
    // from a fresh mount — otherwise canBill && intakeSent's "Convert to
    // bill" button wouldn't show until *this* visit sent something, even
    // for a prescription sent in an earlier session entirely.
    const alreadySaved = prescription.medicines.length > 0;
    setStep(alreadySaved ? 'details' : 'intake');
    setIntakeSent(alreadySaved);
    setOpenRowMenu(null);
    setDoctor(prescription.doctor);
    setDurationToken(prescription.durationToken);
    setCustomDays(prescription.customDays);
    setMemberName(prescription.memberName);
    setMemberPhone(prescription.memberPhone);
    setPatientId(prescription.patientId);
    setStoreId(prescription.storeId);
    // Only when the open prescription changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prescription?.id]);

  function patchRow(i: number, patch: Partial<PrescriptionMedicineInput>) {
    setDraft((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  /** The Details step's "Medicines to bill" table select-all checkbox —
   *  every named row's own checkbox at once, in one state update instead
   *  of one patchRow per row. Same mechanism each row's own checkbox
   *  already uses: stock status 'available' when selected, 'not_possible'
   *  (excluded from billing) when cleared. */
  function setAllBillable(selected: boolean) {
    setDraft((d) =>
      d.map((row) =>
        row.name.trim()
          ? { ...row, status: selected ? 'available' : 'not_possible' }
          : row,
      ),
    );
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

  /** Swaps row [i] up into the open entry card (index 0) for full-size
   *  editing — the table's own cells stay usable for a quick tweak, but a
   *  bigger change (working through Route & time's drop-count picker, say)
   *  is easier in the card. Whatever was open in the card — usually still
   *  blank — swaps down into [i]'s old spot rather than being dropped, so
   *  a half-typed row already being drafted is never silently lost. Swaps
   *  the preset-dropdown selections the same way, so neither row's picks
   *  follow the wrong data after the swap. */
  function editRow(i: number) {
    if (i === 0) return;
    setDraft((d) => {
      const next = [...d];
      [next[0], next[i]] = [next[i], next[0]];
      return next;
    });
    function swap<T>(m: Record<number, T>): Record<number, T> {
      const next = { ...m };
      const a = next[0];
      const b = next[i];
      if (b === undefined) delete next[0];
      else next[0] = b;
      if (a === undefined) delete next[i];
      else next[i] = a;
      return next;
    }
    setSelectedFrequency(swap);
    setSelectedRouteCode(swap);
    setDropCount(swap);
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

  /** The intake view keeps exactly one row open for editing at a time —
   *  index 0, the top of the list — and shows every earlier line already
   *  filled in as a compact table row below it. Confirming the open row
   *  (the "Add to list" button under its card, or Enter in its Name/
   *  Quantity field) calls the existing [addRow] unchanged: it prepends a
   *  fresh blank row, which both opens a new entry card and pushes the
   *  just-filled row down into the table, in one step. A blank name is
   *  refused rather than committed as an empty table line. */
  function commitTopRow() {
    const top = draft[0];
    if (!top || !top.name.trim()) return;
    addRow();
  }

  /** The one open entry card — always draft row 0, see [commitTopRow]'s
   *  doc — with an explicit "Add to list" button and Enter-to-add on its
   *  Name and Quantity fields. */
  function renderMedicineCard() {
    const i = 0;
    const row = draft[i];
    const handleEnterToAdd = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTopRow();
      }
    };
    return (
                    <div
                      className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-800"
                    >
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">
                          Medicine {i + 1}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-500 hover:text-rose-600"
                          onClick={() => removeRow(i)}
                        >
                          Remove
                        </button>
                      </div>
                      <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Name
                      </p>
                      <input
                        value={row.name}
                        onChange={(e) => patchRow(i, { name: e.target.value })}
                        onKeyDown={handleEnterToAdd}
                        placeholder="e.g. Paracetamol 500mg"
                        className={compactInputClass}
                      />
                      <p className="mb-0.5 mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
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
                          className="shrink-0 rounded-md border border-slate-300 bg-white p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
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
                            onClick={() => setAddingTypeFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      <p className="mb-0.5 mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Quantity
                      </p>
                      <input
                        value={row.totalUnits || ''}
                        onChange={(e) =>
                          patchRow(i, {
                            totalUnits: Number(e.target.value) || 0,
                          })
                        }
                        onKeyDown={handleEnterToAdd}
                        placeholder="Number of units"
                        inputMode="numeric"
                        className={compactInputClass}
                      />
                      <p className="mb-0.5 mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
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
                          className="shrink-0 rounded-md border border-slate-300 bg-white p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                        >
                          <Icon name="plus" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {row.intake && (
                        <p className="mt-1 text-xs text-slate-500">
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
                            onClick={() => setAddingFrequencyFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      <p className="mb-0.5 mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
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
                            className={`${compactInputClass} w-[92px] shrink-0`}
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
                          className="shrink-0 rounded-md border border-slate-300 bg-white p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
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
                            onClick={() => setAddingRouteTimeFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                      <p className="mb-0.5 mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
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
                          className={`${compactInputClass} flex-1`}
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
                      <p className="mt-1 text-xs text-slate-500">
                        For the counter only — never shown in the member's app.
                      </p>
                    </div>
    );
  }

  /** Every already-added line (everything but the open entry card at draft
   *  row 0) as a compact table — full width, under the intake card and
   *  script image both, not squeezed into the card's own column. Name/
   *  Type/Qty stay lightly editable in place; the "add a new type/intake/
   *  route" mini-forms only exist on the open card, so introducing
   *  something brand new naturally happens before a line is committed,
   *  not after. Always rendered, even with nothing added yet — the header
   *  row is what makes "+ Add to list" legible as "goes here". */
  function renderMedicineTable() {
    return (
      // overflow-x-auto alone (with no overflow-y set) makes the browser
      // implicitly compute overflow-y as auto too — the CSS spec doesn't
      // allow "scrollable on x, visible on y" — which was quietly giving
      // this its own second vertical scroll region (on top of the Modal
      // body's single one) and clipping the row-actions dropdown menu
      // (absolutely positioned inside a <td> here) whenever it extended
      // past that accidental scroll boundary. overflow-y-visible overrides
      // it back to normal — horizontal scroll for a wide table stays,
      // nothing about vertical sizing or scrolling is affected by this
      // element any more.
      <div className="overflow-x-auto overflow-y-visible rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Intake</th>
              <th className="px-3 py-2">Route &amp; time</th>
              <th className="px-3 py-2">Stock status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {draft.length <= 1 && (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-center text-slate-400">
                  Added medicines land here.
                </td>
              </tr>
            )}
            {draft.slice(1).map((row, idx) => {
              const i = idx + 1;
              return (
                <tr key={i} className="align-top">
                  <td className="min-w-[140px] px-3 py-2">
                    <input
                      value={row.name}
                      onChange={(e) => patchRow(i, { name: e.target.value })}
                      placeholder="e.g. Paracetamol 500mg"
                      className={inputClass}
                    />
                  </td>
                  <td className="min-w-[120px] px-3 py-2">
                    <Combobox
                      value={row.pack}
                      onChange={(v) => patchRow(i, { pack: v })}
                      options={typeOptions.map((t) => ({ value: t, label: t }))}
                      placeholder="Type"
                      searchPlaceholder="Search types…"
                    />
                  </td>
                  <td className="w-20 px-3 py-2">
                    <input
                      value={row.totalUnits || ''}
                      onChange={(e) =>
                        patchRow(i, { totalUnits: Number(e.target.value) || 0 })
                      }
                      placeholder="Qty"
                      inputMode="numeric"
                      className={inputClass}
                    />
                  </td>
                  <td className="min-w-[140px] px-3 py-2">
                    <Combobox
                      value={selectedFrequency[i] ?? ''}
                      onChange={(v) => {
                        setSelectedFrequency((m) => ({ ...m, [i]: v }));
                        const preset = frequencyOptions.find((f) => f.code === v);
                        if (preset) applyFrequency(i, preset);
                      }}
                      options={frequencyOptions.map((f) => ({
                        value: f.code,
                        label: f.description ? `${f.code} — ${f.description}` : f.code,
                      }))}
                      placeholder="OD, BD, TDS, …"
                      searchPlaceholder="Search intake presets…"
                    />
                  </td>
                  <td className="min-w-[160px] px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Combobox
                        value={selectedRouteCode[i] ?? row.routeTime}
                        onChange={(v) => applyRouteTime(i, v)}
                        options={routeTimeOptions.map((r) => ({
                          value: r.code,
                          label: r.description ? `${r.code} — ${r.description}` : r.code,
                        }))}
                        placeholder="Route & time"
                        searchPlaceholder="Search route & time…"
                        className="flex-1"
                      />
                      {isDropRouteCode(selectedRouteCode[i] ?? '') && (
                        <select
                          value={dropCount[i] ?? 1}
                          onChange={(e) => applyDropCount(i, Number(e.target.value))}
                          title="Number of drops"
                          className={`${inputClass} w-16 shrink-0`}
                        >
                          {[1, 2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="min-w-[150px] px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <select
                        value={row.status}
                        onChange={(e) =>
                          patchRow(i, {
                            status: e.target.value as PrescriptionMedicineStatus,
                          })
                        }
                        className={inputClass}
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
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div
                      className="relative inline-block"
                      ref={openRowMenu === i ? rowMenuRef : undefined}
                    >
                      <button
                        type="button"
                        title="Row actions"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={() =>
                          setOpenRowMenu((cur) => (cur === i ? null : i))
                        }
                      >
                        <Icon name="more-vertical" className="h-4 w-4" />
                      </button>
                      {openRowMenu === i && (
                        <div className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg">
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                            onClick={() => {
                              editRow(i);
                              setOpenRowMenu(null);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                            onClick={() => {
                              removeRow(i);
                              setOpenRowMenu(null);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
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
   *  {@link convertToBill} need before writing anything — split out so
   *  "Convert to bill" (reachable straight from the Intake step) can catch
   *  a gap here and send the reviewer to the Details step to fill it,
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
   *  and {@link convertToBill} (hands off to the Bills page instead). */
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

  /** The Details step's first save — everything up to and including the
   *  intake card, in one go. Stays open rather than closing: the moment
   *  this succeeds, `onSaved()`'s reload flips the prescription off
   *  `awaiting_review`, `canBill` turns true, and this same button's slot
   *  in the footer swaps from "Update/Send intake card" to "Convert to
   *  bill →" — so a reviewer never has to reopen the prescription just to
   *  see it appear. */
  async function sendIntake() {
    if (!validateDetails()) return;
    if (await saveDetailsAndIntake()) {
      setIntakeSent(true);
      onSaved();
    }
  }

  /** The intake step's own primary action now — Save, not a plain "Next"
   *  that only navigates. Validates and saves everything in one go (the
   *  medicines here plus the Details fields, already prefilled from the
   *  member's own order so this passes without ever having to visit that
   *  step separately), sends the intake card to the member, and closes
   *  the modal — reviewing this script is done. Falls back to actually
   *  showing the Details step, same as {@link convertToBill}, only when
   *  something there genuinely needs a reviewer's attention first (a
   *  blank contact field, no patient picked) rather than closing on top
   *  of an error. */
  async function saveIntakeAndClose() {
    if (!validateDetails()) {
      setStep('details');
      return;
    }
    if (await saveDetailsAndIntake()) {
      setIntakeSent(true);
      onSaved();
      onClose();
    }
  }

  /** "Convert to bill →" — the Details step's primary action once
   *  {@link sendIntake} has run at least once (`canBill`), replacing it in
   *  the footer rather than sitting alongside it. Re-saves everything (a
   *  reviewer may have edited Details since) and hands off to the Bills
   *  page (`BillEditorModal`), which does the pricing, the
   *  medicine-by-status picker, and the OTP-gated wallet/cash collection
   *  for this order. Only falls back to actually showing the Details step
   *  when something on it needs a reviewer's attention first (a blank
   *  contact field, no patient picked, the save itself failing, or the
   *  prescription somehow has no linked order yet) — the modal stays open
   *  either way, never closes on this path. */
  async function convertToBill() {
    if (!validateDetails()) {
      setStep('details');
      return;
    }
    if (await saveDetailsAndIntake()) {
      onSaved();
      if (prescription?.orderId) {
        // The Bills page lists only orders stamped as converted, so this
        // has to land before handing off or the order wouldn't show there.
        try {
          await markOrderConvertedToBill(prescription.orderId);
        } catch (err) {
          setDetailsError(
            err instanceof Error ? err.message : 'Could not convert this order to a bill.',
          );
          setStep('details');
          return;
        }
        // Close this modal outright rather than leaving it mounted
        // underneath the navigation — Convert to bill hands off to the
        // Bills page's own editor for this exact order, not something to
        // come back to here.
        onClose();
        navigate(`/bills?open=${prescription.orderId}`);
      } else {
        // Was a silent no-op before — setStep('details') when we're
        // already on that step changes nothing on screen, so clicking
        // "Convert to bill" with no linked order looked exactly like the
        // button did nothing at all, with no way to tell why. This is the
        // one real reason conversion can't proceed here (everything else
        // that can block it already sets its own detailsError above).
        setDetailsError(
          'This prescription has no linked order yet, so there is nothing to convert to a bill.',
        );
      }
    } else {
      setStep('details');
    }
  }

  const contactedAt = contactMarkedAt || linkedOrder?.storeContactedAt || '';

  /** Call / WhatsApp was tapped: stamp the linked order as contacted so the
   *  member's Track order moves to "Store contact". Fire-and-forget from the
   *  link's own onClick — the call or chat opens regardless. */
  async function noteContact() {
    if (!prescription?.orderId || contactedAt) return;
    try {
      const at = await markOrderStoreContacted(prescription.orderId);
      if (at) {
        setContactMarkedAt(at);
        onSaved();
      }
    } catch (err) {
      setDetailsError(
        err instanceof Error
          ? `Couldn't record the contact: ${err.message}`
          : "Couldn't record the contact.",
      );
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

  // Can this prescription's order be billed at all -- the same "at least
  // read" gate that unlocks the "Convert to bill" button in the footer, and
  // a linked order to actually invoice against.
  const canBill = Boolean(
    prescription && prescription.status !== 'awaiting_review',
  );

  // Every prescribed medicine the counter is actually expected to supply --
  // everything except a line the reviewer has marked "Not possible" (that
  // one is never going to be billed, so it can't be the reason completion
  // stays blocked). Compared against the *real* order's own bill lines —
  // `linkedOrder`, read back fresh above — rather than any local draft,
  // since pricing now happens entirely on the Bills page and this modal
  // never sees it as it's typed.
  const billableMedicineNames = useMemo(
    () =>
      draft
        .filter((m) => m.name.trim() && m.status !== 'not_possible')
        .map((m) => m.name.trim().toLowerCase()),
    [draft],
  );
  const billedMedicineNames = useMemo(
    () => new Set((linkedOrder?.billLines ?? []).map((l) => l.name.trim().toLowerCase())),
    [linkedOrder],
  );
  const unbilledMedicineCount = useMemo(
    () => billableMedicineNames.filter((n) => !billedMedicineNames.has(n)).length,
    [billableMedicineNames, billedMedicineNames],
  );
  const fullyBilled =
    billableMedicineNames.length > 0 && unbilledMedicineCount === 0;
  const hasBill = (linkedOrder?.billAmount ?? 0) > 0;
  const billIsPaid = linkedOrder?.billStatus === 'paid';

  /** Step 7 of this flow: closing out the order is always this explicit
   *  click, never a side effect of sending or paying the bill (which now
   *  happens entirely in `BillEditorModal` on the Bills page) — and it's
   *  blocked while any medicine that's actually expected (i.e. not marked
   *  "Not possible") is still missing from the real bill, so a
   *  partially-filled script can't accidentally read as finished. */
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
        size="full"
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
                variant="primary"
                disabled={!draftHasRows || sending}
                onClick={() => void saveIntakeAndClose()}
              >
                {sending ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
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
              {canBill && hasBill && (
                <Button
                  variant="secondary"
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
              {canBill && intakeSent ? (
                <Button
                  variant="primary"
                  disabled={sending || billableMedicineNames.length === 0}
                  title={
                    billableMedicineNames.length === 0
                      ? 'Check at least one medicine in the table above first'
                      : undefined
                  }
                  onClick={() => void convertToBill()}
                >
                  {sending ? 'Converting…' : 'Convert to bill →'}
                </Button>
              ) : (
                <Button variant="primary" disabled={sending} onClick={sendIntake}>
                  {sending
                    ? 'Sending…'
                    : prescription.medicines.length > 0
                      ? 'Update intake card'
                      : 'Send intake card'}
                </Button>
              )}
            </>
          ))
        }
      >
        {prescription && (
          // The Modal's own body (see Modal.tsx) is the one scrolling
          // region for this whole screen — everything below just flows
          // normally inside it, a single page with a single scrollbar,
          // not its own further-nested fixed/scrolling sub-regions.
          <>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Left: the intake card against the uploaded script on the
                intake step; the medicines-to-bill checkbox table against
                the member/order details form on the Details step — same
                left-table/right-context shape both times. */}
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
                  {step === 'intake' ? '1 of 2 · Intake card' : '2 of 2 · Details'}
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
                  {draft.length > 0 && renderMedicineCard()}
                  {draft.length === 0 && (
                    <p className="text-sm text-slate-400">
                      No lines yet — add the medicines from the script.
                    </p>
                  )}
                </div>
              </div>
              ) : (
                <>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Medicines to bill
                  </p>
                  <p className="mb-2 text-xs text-slate-400">
                    Uncheck anything that shouldn't go on this bill — the
                    same as marking it "Not possible" on the intake card.
                    Pricing and payment collection themselves still happen
                    on the Bills page once you convert.
                  </p>
                  <div className="overflow-x-auto overflow-y-visible rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">
                            <input
                              type="checkbox"
                              title={
                                billableMedicineNames.length === draft.filter((r) => r.name.trim()).length
                                  ? 'Clear all'
                                  : 'Select all'
                              }
                              checked={
                                draftHasRows &&
                                billableMedicineNames.length ===
                                  draft.filter((r) => r.name.trim()).length
                              }
                              ref={(el) => {
                                if (!el) return;
                                const namedCount = draft.filter((r) => r.name.trim()).length;
                                el.indeterminate =
                                  billableMedicineNames.length > 0 &&
                                  billableMedicineNames.length < namedCount;
                              }}
                              onChange={(e) => setAllBillable(e.target.checked)}
                              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                          </th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Stock status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {draftHasRows ? (
                          draft.map((row, i) => {
                            if (!row.name.trim()) return null;
                            const checked = row.status !== 'not_possible';
                            return (
                              <tr key={i} className="align-top">
                                <td className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) =>
                                      patchRow(i, {
                                        status: e.target.checked
                                          ? 'available'
                                          : 'not_possible',
                                      })
                                    }
                                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                                  />
                                </td>
                                <td className="px-3 py-2">{row.name}</td>
                                <td className="px-3 py-2">{row.pack || '—'}</td>
                                <td className="px-3 py-2">{row.totalUnits || '—'}</td>
                                <td className="px-3 py-2">
                                  <Badge tone={STOCK_STATUS_TONE[row.status]}>
                                    {STOCK_STATUS_LABEL[row.status]}
                                  </Badge>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-3 py-3 text-center text-slate-400"
                            >
                              No medicines on this script yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Right on the Details step — the member/order context the
                checkbox table on the left needs: who this is for, which
                branch, the fulfilment/upload facts, doctor and duration.
                Was the only column here before the checkbox table moved
                in on its left; unchanged otherwise, just relocated. */}
            {step === 'details' && (
              <div>
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
                          <div>
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
                                onClick={() => void noteContact()}
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
                                onClick={() => void noteContact()}
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
                            {prescription.orderId && (
                              <p className="mt-1 text-xs font-normal text-slate-400">
                                {contactedAt
                                  ? `Store contact recorded · ${formatDateTime(contactedAt)}`
                                  : 'Call or WhatsApp marks this order "Store contact" in the member\'s app.'}
                              </p>
                            )}
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
                  {canBill && (
                    <p className="mt-3 text-xs text-slate-500">
                      {hasBill
                        ? `Bill: ${linkedOrder ? formatCurrency(linkedOrder.billAmount) : '—'} (${billIsPaid ? 'Paid' : 'Pending'})${
                            !fullyBilled
                              ? ` — ${unbilledMedicineCount} medicine${unbilledMedicineCount === 1 ? '' : 's'} still not on the bill`
                              : ''
                          }`
                        : 'Not billed yet — use "Convert to bill" to price and send it from the Bills page.'}
                    </p>
                  )}
                  {completeError && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {completeError}
                    </p>
                  )}
                </>
              </div>
            )}


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
          {/* Outside the card itself on purpose — a separate, static
              action row, not one more thing competing for attention
              inside the card. Same commitTopRow as Enter in the card's
              Name/Quantity fields. Remove sits right next to it too — the
              card's own top-corner Remove still works the same, this is
              just always in reach without scrolling back up to it. */}
          {step === 'intake' && draft.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={!draft[0].name.trim()}
                onClick={commitTopRow}
              >
                + Add to list
              </Button>
              <Button variant="secondary" size="sm" onClick={() => removeRow(0)}>
                Remove
              </Button>
            </div>
          )}
          {/* Full width, under the card and the script image both — not
              squeezed into the card's own column. */}
          {step === 'intake' && (
            <div className="mt-4">{renderMedicineTable()}</div>
          )}
          </>
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
