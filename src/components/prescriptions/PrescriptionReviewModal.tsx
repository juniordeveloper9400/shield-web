import { useEffect, useMemo, useState } from 'react';
import { Badge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Combobox } from '@/components/ui/Combobox';
import { DetailList } from '@/components/ui/DetailList';
import { formatDateTime, toneForStatus } from '@/lib/format';
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
  loadCustomRouteTimes,
  ROUTE_TIME_PRESETS,
} from '@/lib/routeTimes';
import {
  savePrescriptionIntake,
  setPrescriptionImageRotation,
  setPrescriptionStatus,
  updatePrescriptionBranch,
  updatePrescriptionDetails,
  updatePrescriptionPatient,
} from '@/api/prescriptions';
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
  'w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

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
  not_possible: 'Not possible',
};
const STOCK_STATUS_TONE: Record<PrescriptionMedicineStatus, Tone> = {
  available: 'green',
  out_of_stock: 'amber',
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

  // Every branch, for the "Branch" dropdown on the Details step.
  const { data: storeRows } = useAsync(listStores, []);
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

  // Every patient this member has saved (self, family, …), for the Patient
  // picker — reloaded whenever a different prescription (so a different
  // member) is open. A patient added inline from the "+" below is merged in
  // locally so it shows selected right away, without waiting on a refetch.
  const { data: patientRows, reload: reloadPatients } = useAsync(
    () => (prescription ? listPatients(prescription.memberId) : Promise.resolve([])),
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

  // Degrees clockwise, one of 0/90/180/270 — a script photographed sideways or
  // upside down is common enough to need fixing. Starts from whatever was
  // last saved for this prescription (app.prescription.image_rotation), not
  // always 0, and every further rotation is saved the same way — the fix is
  // permanent, not just for this one look.
  const [rotation, setRotation] = useState(0);
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
  // showing it instead of snapping back to the placeholder -- applying a
  // preset doesn't leave a single field behind to read it back from (an
  // intake-shaped one overwrites row.intake, the rest append free text).
  const [selectedFrequency, setSelectedFrequency] = useState<
    Record<number, string>
  >({});

  /** Appends [label] to row [i]'s Route & time, separated from whatever is
   *  already there — the shared landing spot for anything (a frequency that
   *  doesn't fit Intake, or a route/timing preset) that reads as free text
   *  rather than a structured code. */
  function appendRouteTime(i: number, label: string) {
    setDraft((d) =>
      d.map((row, j) =>
        j === i
          ? {
              ...row,
              routeTime: row.routeTime ? `${row.routeTime} · ${label}` : label,
            }
          : row,
      ),
    );
  }

  function applyFrequency(i: number, preset: FrequencyPreset) {
    if (preset.intakeCode) {
      patchRow(i, { intake: preset.intakeCode });
      return;
    }
    appendRouteTime(
      i,
      preset.description ? `${preset.code} — ${preset.description}` : preset.code,
    );
  }

  function confirmNewFrequency(i: number) {
    const trimmed = newFrequencyValue.trim();
    setAddingFrequencyFor(null);
    setNewFrequencyValue('');
    if (!trimmed) return;
    const updated = addCustomFrequency(trimmed, '');
    setCustomFrequencies(updated);
    setSelectedFrequency((m) => ({ ...m, [i]: trimmed }));
    applyFrequency(i, { code: trimmed, description: '', intakeCode: null });
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

  function confirmNewRouteTime(i: number) {
    const trimmed = newRouteTimeValue.trim();
    setAddingRouteTimeFor(null);
    setNewRouteTimeValue('');
    if (!trimmed) return;
    setCustomRouteTimes(addCustomRouteTime(trimmed, ''));
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
    if (!prescription) {
      setDraft([]);
      setImageOpen(false);
      setRotation(0);
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
    setRotation(prescription.imageRotation);
    setStep('intake');
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

  /** Drops row [i] and shifts the preset-dropdown selections above it down
   *  by one index, so removing a row from the middle doesn't leave a later
   *  row's dropdown showing a preset that was actually picked for a
   *  different line. */
  function removeRow(i: number) {
    setDraft((d) => d.filter((_, j) => j !== i));
    const reindex = (m: Record<number, string>) => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(m)) {
        const idx = Number(k);
        if (idx < i) next[idx] = v;
        else if (idx > i) next[idx - 1] = v;
      }
      return next;
    };
    setSelectedFrequency(reindex);
  }

  /** Rotates by [delta] degrees and saves it immediately — a reviewer
   *  rotating a sideways script fixes it for good, not just for this look,
   *  so there is no separate "save rotation" step to forget. */
  async function rotateImage(delta: 90 | -90) {
    if (!prescription) return;
    const next = (((rotation + delta) % 360) + 360) % 360;
    setRotation(next);
    setRotating(true);
    try {
      await setPrescriptionImageRotation(prescription.id, next as 0 | 90 | 180 | 270);
    } finally {
      setRotating(false);
    }
  }

  /** The final action, from the Details step: saves every correction on this
   *  screen — the member's own name/phone, which patient this is for, the
   *  pinned branch, and the doctor/duration — alongside the intake card in
   *  one go, then closes. */
  async function sendIntake() {
    if (!prescription) return;
    if (!memberName.trim() || !memberPhone.trim()) {
      setDetailsError('Member name and phone cannot be blank.');
      return;
    }
    if (!patientId) {
      setDetailsError('Pick which patient this prescription is for.');
      return;
    }
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
        return;
      }
      await updatePrescriptionPatient(prescription.id, patientId);
      await updatePrescriptionBranch(prescription.id, storeId || null);
      await updatePrescriptionDetails(prescription.id, {
        doctor,
        durationToken,
        customDays,
      });
      await savePrescriptionIntake(prescription.id, draft);
      onSaved();
      onClose();
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : 'Could not save these details.',
      );
    } finally {
      setSending(false);
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
                variant="primary"
                disabled={!draftHasRows}
                onClick={() => setStep('details')}
              >
                Next: Details →
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
              <Button variant="primary" disabled={sending} onClick={sendIntake}>
                {sending
                  ? 'Sending…'
                  : prescription.medicines.length > 0
                    ? 'Update intake card'
                    : 'Send intake card'}
              </Button>
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
                <Badge tone={toneForStatus(prescription.status)}>
                  {STATUS_LABEL[prescription.status]}
                </Badge>
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
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-600"
                    onClick={() => setDraft((d) => [...d, { ...EMPTY_ROW }])}
                  >
                    + Add medicine
                  </button>
                </div>
                <p className="mb-2 text-xs text-slate-400">
                  Pick an Intake preset below for how often each medicine is
                  taken — it fills in the three-digit morning-afternoon-night
                  code the customer's app expands when you send this.
                </p>
                <div className="space-y-2">
                  {draft.map((row, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-slate-200 p-2.5"
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">
                          Medicine {i + 1}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-600"
                          onClick={() => removeRow(i)}
                        >
                          Remove
                        </button>
                      </div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Name
                      </p>
                      <input
                        value={row.name}
                        onChange={(e) => patchRow(i, { name: e.target.value })}
                        placeholder="e.g. Paracetamol 500mg"
                        className={inputClass}
                      />
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
                          className="shrink-0 rounded-md border border-slate-300 p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
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
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
                          placeholder="OD, BD, TDS, HS, q4h, …"
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
                          className="shrink-0 rounded-md border border-slate-300 p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                        >
                          <Icon name="plus" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {row.intake && (
                        <p className="mt-1 text-xs text-slate-400">
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
                            placeholder="New intake preset (e.g. Alternate days)"
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
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Route &amp; time
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Combobox
                          value={row.routeTime}
                          onChange={(v) => patchRow(i, { routeTime: v })}
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
                        <button
                          type="button"
                          title="Add a new route / time"
                          onClick={() => {
                            setAddingRouteTimeFor(i);
                            setNewRouteTimeValue('');
                          }}
                          className="shrink-0 rounded-md border border-slate-300 p-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
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
                      <p className="mb-1 mt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
                      <p className="mt-1 text-xs text-slate-400">
                        For the counter only — never shown in the member's app.
                      </p>
                    </div>
                  ))}
                  {draft.length === 0 && (
                    <p className="text-sm text-slate-400">
                      No lines yet — add the medicines from the script.
                    </p>
                  )}
                </div>
              </div>
              ) : (
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
              )}
            </div>

            {/* Right — the uploaded script, kept in view against the intake
                card; no longer needed once it's just the details form. */}
            {step === 'intake' && (
            <div className="order-1 md:order-2 md:sticky md:top-0 md:self-start">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Uploaded script
                </p>
                {prescription.image && (
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
              {prescription.image ? (
                <div className="flex w-full items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2">
                  <button
                    type="button"
                    onClick={() => setImageOpen(true)}
                    className="block"
                  >
                    <img
                      src={prescription.image}
                      alt={`Prescription ${prescription.code}`}
                      className="object-contain transition-transform duration-200"
                      style={{
                        transform: `rotate(${rotation}deg)`,
                        // A quarter-turn swaps the image's effective footprint
                        // — capped to the sidebar's own width when on its
                        // side, rather than the taller-than-wide budget an
                        // upright script reads comfortably at.
                        maxWidth: rotation % 180 === 0 ? '100%' : 220,
                        maxHeight: rotation % 180 === 0 ? '55vh' : '100%',
                      }}
                    />
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-10 text-center text-sm text-slate-400">
                  No image was uploaded with this prescription.
                </div>
              )}
              {prescription.image && (
                <p className="mt-1.5 text-xs text-slate-400">
                  Tap the image to view it full size, or use the rotate
                  buttons above to fix a sideways scan for good.
                </p>
              )}
            </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        title={prescription ? `${prescription.code} — script` : ''}
        footer={
          prescription?.image && (
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
        {prescription?.image && (
          <div className="flex min-h-[50vh] items-center justify-center overflow-hidden">
            <img
              src={prescription.image}
              alt={`Prescription ${prescription.code}`}
              className="object-contain transition-transform duration-200"
              style={{
                transform: `rotate(${rotation}deg)`,
                // A quarter-turn swaps the image's effective footprint, so the
                // side capped to the viewport has to swap too or a portrait
                // script rotated on its side would overflow the modal width.
                maxWidth: rotation % 180 === 0 ? '100%' : '70vh',
                maxHeight: rotation % 180 === 0 ? '70vh' : '80vw',
              }}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
