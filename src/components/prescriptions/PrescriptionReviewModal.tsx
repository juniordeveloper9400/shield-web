import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { DetailList } from '@/components/ui/DetailList';
import { formatDateTime, toneForStatus } from '@/lib/format';
import {
  savePrescriptionIntake,
  setPrescriptionImageRotation,
  setPrescriptionStatus,
} from '@/api/prescriptions';
import type { Prescription, PrescriptionMedicineInput, PrescriptionStatus } from '@/types';

const inputClass =
  'w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

const EMPTY_ROW: PrescriptionMedicineInput = {
  name: '',
  pack: '',
  intake: '',
  totalUnits: 0,
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
  // Degrees clockwise, one of 0/90/180/270 — a script photographed sideways or
  // upside down is common enough to need fixing. Starts from whatever was
  // last saved for this prescription (app.prescription.image_rotation), not
  // always 0, and every further rotation is saved the same way — the fix is
  // permanent, not just for this one look.
  const [rotation, setRotation] = useState(0);
  const [rotating, setRotating] = useState(false);

  // Load the open prescription's existing lines into the editor (or one blank
  // row to start from).
  useEffect(() => {
    if (!prescription) {
      setDraft([]);
      setImageOpen(false);
      setRotation(0);
      return;
    }
    setDraft(
      prescription.medicines.length > 0
        ? prescription.medicines.map((m) => ({
            name: m.name,
            pack: m.pack,
            intake: `${m.doseMorning}${m.doseAfternoon}${m.doseNight}`,
            totalUnits: m.totalUnits,
          }))
        : [{ ...EMPTY_ROW }],
    );
    setRotation(prescription.imageRotation);
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

  async function sendIntake() {
    if (!prescription) return;
    setSending(true);
    try {
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
          prescription && (
            <>
              {prescription.status !== 'awaiting_review' && (
                <Button
                  variant="secondary"
                  disabled={saving || sending}
                  onClick={() => changeStatus('awaiting_review')}
                >
                  Back to awaiting
                </Button>
              )}
              <Button
                variant="primary"
                disabled={sending || !draftHasRows}
                onClick={sendIntake}
              >
                {sending
                  ? 'Sending…'
                  : prescription.medicines.length > 0
                    ? 'Update intake card'
                    : 'Send intake card'}
              </Button>
            </>
          )
        }
      >
        {prescription && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
            {/* Left — status, details and the intake-card editor. */}
            <div className="order-2 md:order-1">
              <div className="mb-3">
                <Badge tone={toneForStatus(prescription.status)}>
                  {STATUS_LABEL[prescription.status]}
                </Badge>
              </div>

              <DetailList
                rows={[
                  { label: 'Member', value: prescription.memberName },
                  { label: 'Phone', value: prescription.memberPhone },
                  { label: 'Patient', value: prescription.patientName },
                  { label: 'Doctor', value: prescription.doctor || '—' },
                  { label: 'Branch', value: prescription.storeName },
                  { label: 'Duration', value: prescription.duration },
                  {
                    label: 'Uploaded',
                    value: formatDateTime(prescription.createdAt),
                  },
                ]}
              />

              <div className="mt-4">
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
                  Intake is the three-digit morning-afternoon-night code (e.g.
                  101). The customer's app expands their card when you send
                  this.
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
                      <input
                        value={row.name}
                        onChange={(e) => patchRow(i, { name: e.target.value })}
                        placeholder="Medicine name"
                        className={`${inputClass} mb-1.5`}
                      />
                      <div className="grid grid-cols-3 gap-1.5">
                        <input
                          value={row.pack}
                          onChange={(e) => patchRow(i, { pack: e.target.value })}
                          placeholder="Pack"
                          className={inputClass}
                        />
                        <input
                          value={row.intake}
                          onChange={(e) =>
                            patchRow(i, { intake: e.target.value })
                          }
                          placeholder="Intake (101)"
                          inputMode="numeric"
                          maxLength={5}
                          className={`${inputClass} text-center tracking-widest`}
                        />
                        <input
                          value={row.totalUnits || ''}
                          onChange={(e) =>
                            patchRow(i, {
                              totalUnits: Number(e.target.value) || 0,
                            })
                          }
                          placeholder="Units"
                          inputMode="numeric"
                          className={`${inputClass} text-right`}
                        />
                      </div>
                    </div>
                  ))}
                  {draft.length === 0 && (
                    <p className="text-sm text-slate-400">
                      No lines yet — add the medicines from the script.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right — the uploaded script, held in view while the form
                scrolls on the left. */}
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
