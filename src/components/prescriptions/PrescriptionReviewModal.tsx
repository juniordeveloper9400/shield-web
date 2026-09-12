import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
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
  type RoutePreset,
} from '@/lib/routeTimes';
import {
  savePrescriptionIntake,
  setPrescriptionImageRotation,
  setPrescriptionStatus,
  updatePrescriptionDetails,
} from '@/api/prescriptions';
import type { Prescription, PrescriptionMedicineInput, PrescriptionStatus } from '@/types';

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

const EMPTY_ROW: PrescriptionMedicineInput = {
  name: '',
  pack: '',
  intake: '',
  totalUnits: 0,
  routeTime: '',
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
    applyFrequency(i, { code: trimmed, description: '', intakeCode: null });
  }

  // Route / timing presets (SL/PR/IV/OU-drops/AF-AC/SOS/…) — always inserted
  // as text into Route & time, same as a non-fitting frequency.
  const [customRouteTimes, setCustomRouteTimes] = useState<RoutePreset[]>(() =>
    loadCustomRouteTimes(),
  );
  const routeTimeOptions = useMemo(
    () => [...ROUTE_TIME_PRESETS, ...customRouteTimes],
    [customRouteTimes],
  );
  const [addingRouteTimeFor, setAddingRouteTimeFor] = useState<number | null>(
    null,
  );
  const [newRouteTimeValue, setNewRouteTimeValue] = useState('');

  function applyRouteTime(i: number, preset: RoutePreset) {
    appendRouteTime(
      i,
      preset.description ? `${preset.code} — ${preset.description}` : preset.code,
    );
  }

  function confirmNewRouteTime(i: number) {
    const trimmed = newRouteTimeValue.trim();
    setAddingRouteTimeFor(null);
    setNewRouteTimeValue('');
    if (!trimmed) return;
    const updated = addCustomRouteTime(trimmed, '');
    setCustomRouteTimes(updated);
    applyRouteTime(i, { code: trimmed, description: '' });
  }

  // Load the open prescription's existing lines into the editor (or one blank
  // row to start from).
  useEffect(() => {
    if (!prescription) {
      setDraft([]);
      setImageOpen(false);
      setRotation(0);
      setStep('intake');
      setDoctor('');
      setDurationToken('');
      setCustomDays(0);
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
          }))
        : [{ ...EMPTY_ROW }],
    );
    setRotation(prescription.imageRotation);
    setStep('intake');
    setDoctor(prescription.doctor);
    setDurationToken(prescription.durationToken);
    setCustomDays(prescription.customDays);
    // Only when the open prescription changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prescription?.id]);

  function patchRow(i: number, patch: Partial<PrescriptionMedicineInput>) {
    setDraft((d) => d.map((row, j) => (j === i ? { ...row, ...patch } : row)));
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

  /** The final action, from the Details step: saves the doctor/duration
   *  correction alongside the intake card in one go and closes. */
  async function sendIntake() {
    if (!prescription) return;
    setSending(true);
    try {
      await updatePrescriptionDetails(prescription.id, {
        doctor,
        durationToken,
        customDays,
      });
      await savePrescriptionIntake(prescription.id, draft);
      onSaved();
      onClose();
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
                          onClick={() =>
                            setDraft((d) => d.filter((_, j) => j !== i))
                          }
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
                        <select
                          value={row.pack}
                          onChange={(e) => patchRow(i, { pack: e.target.value })}
                          className={`${inputClass} flex-1`}
                        >
                          <option value="">Choose a type</option>
                          {/* An old free-text value not in the list (or one
                              typed here before the app reloaded) still shows
                              selected, via this synthetic option, rather
                              than silently reverting to blank. */}
                          {row.pack && !typeOptions.includes(row.pack) && (
                            <option value={row.pack}>{row.pack}</option>
                          )}
                          {typeOptions.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
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
                        <select
                          value=""
                          onChange={(e) => {
                            const preset = frequencyOptions.find(
                              (f) => f.code === e.target.value,
                            );
                            if (preset) applyFrequency(i, preset);
                          }}
                          className={`${inputClass} flex-1 text-slate-500`}
                        >
                          <option value="">
                            OD, BD, TDS, HS, q4h, …
                          </option>
                          {frequencyOptions.map((f) => (
                            <option key={f.code} value={f.code}>
                              {f.code}
                              {f.description ? ` — ${f.description}` : ''}
                            </option>
                          ))}
                        </select>
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
                        Route &amp; time preset
                      </p>
                      <div className="flex items-center gap-1.5">
                        <select
                          value=""
                          onChange={(e) => {
                            const preset = routeTimeOptions.find(
                              (r) => r.code === e.target.value,
                            );
                            if (preset) applyRouteTime(i, preset);
                          }}
                          className={`${inputClass} flex-1 text-slate-500`}
                        >
                          <option value="">SL, IV, OU drops, SOS, …</option>
                          {routeTimeOptions.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.code}
                              {r.description ? ` — ${r.description}` : ''}
                            </option>
                          ))}
                        </select>
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
                            placeholder="New route/time (e.g. Nebulized)"
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
                        Route &amp; time
                      </p>
                      <input
                        value={row.routeTime}
                        onChange={(e) =>
                          patchRow(i, { routeTime: e.target.value })
                        }
                        placeholder="e.g. Oral, after food"
                        className={inputClass}
                      />
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
                      { label: 'Member', value: prescription.memberName },
                      { label: 'Phone', value: prescription.memberPhone },
                      { label: 'Patient', value: prescription.patientName },
                      { label: 'Branch', value: prescription.storeName },
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
