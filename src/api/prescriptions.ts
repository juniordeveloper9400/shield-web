import { query } from '@/lib/db';
import { fromEnum, iso, num, toEnum } from '@/lib/mappers';
import type {
  FulfillmentType,
  PaymentStatus,
  Prescription,
  PrescriptionImage,
  PrescriptionMedicine,
  PrescriptionMedicineInput,
  PrescriptionStatus,
} from '@/types';

type Row = Record<string, unknown>;

const DURATION_LABEL: Record<string, string> = {
  ONE_WEEK: '1 week',
  FIFTEEN_DAYS: '15 days',
  ONE_MONTH: '1 month',
  TWO_MONTHS: '2 months',
  THREE_MONTHS: '3 months',
};

function durationLabel(r: Row): string {
  const custom = num(r.custom_days);
  if (custom > 0) return `${custom} days`;
  const key = r.duration ? String(r.duration) : '';
  return DURATION_LABEL[key] ?? '—';
}

function toMedicine(r: Row): PrescriptionMedicine {
  return {
    name: String(r.name),
    pack: String(r.pack ?? ''),
    doseMorning: num(r.dose_morning),
    doseAfternoon: num(r.dose_afternoon),
    doseNight: num(r.dose_night),
    totalUnits: num(r.total_units),
    routeTime: String(r.route_time ?? ''),
    status: fromEnum(String(r.status ?? 'AVAILABLE')),
  };
}

/**
 * Uploaded prescriptions, newest first, optionally narrowed to one member.
 * The branch is `app.prescription.store_id` (set by the app at upload), then
 * the branch on the linked `app.prescription_order`, then the member's home
 * branch as a last resort.
 */
async function fetchPrescriptions(memberId?: string): Promise<Prescription[]> {
  const rows = await query<Row>(
    `
    SELECT rx.id, rx.code,
           rx.member_id, rx.patient_id, rx.store_id AS assigned_store_id,
           m.name  AS member_name,
           m.phone AS member_phone,
           pt.name AS patient_name,
           rx.doctor, rx.file_name,
           rx.duration, rx.custom_days, rx.status,
           (rx.image IS NOT NULL) AS has_legacy_image,
           COALESCE(rs.code, os.code, hs.code) AS store_code,
           COALESCE(rs.name, os.name, hs.name) AS store_name,
           rx.created_at,
           pxo.order_id AS linked_order_id,
           rxo.fulfillment_type::text AS order_fulfillment_type,
           rxb.amount AS order_bill_amount,
           rxb.status::text AS order_bill_status
    FROM app.prescription rx
    LEFT JOIN app.users m         ON m.id  = rx.member_id
    LEFT JOIN app.patient pt       ON pt.id = rx.patient_id
    LEFT JOIN app.shield_store rs  ON rs.id = rx.store_id
    LEFT JOIN app.shield_store hs  ON hs.id = m.home_store_id
    LEFT JOIN LATERAL (
      SELECT po.store_id
      FROM app.prescription_order po
      WHERE po.prescription_id = rx.id AND po.store_id IS NOT NULL
      ORDER BY po.id DESC
      LIMIT 1
    ) pol ON true
    LEFT JOIN app.shield_store os  ON os.id = pol.store_id
    -- The order (kind PRESCRIPTION) this script was submitted with — the
    -- most recent prescription_order row that actually has one, since a
    -- prescription can carry more than one over its lifetime (re-submits).
    LEFT JOIN LATERAL (
      SELECT po.order_id
      FROM app.prescription_order po
      WHERE po.prescription_id = rx.id AND po.order_id IS NOT NULL
      ORDER BY po.id DESC
      LIMIT 1
    ) pxo ON true
    LEFT JOIN app."order" rxo ON rxo.id = pxo.order_id
    LEFT JOIN app.bill rxb     ON rxb.order_id = rxo.id
    WHERE rx.deleted_at IS NULL
      AND ($1::bigint IS NULL OR rx.member_id = $1::bigint)
    ORDER BY rx.created_at DESC
    `,
    [memberId ?? null],
  );

  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));
  const medRows = await query<Row>(
    `SELECT prescription_id, name, pack,
            dose_morning, dose_afternoon, dose_night, total_units, route_time,
            status
       FROM app.prescription_medicine
      WHERE prescription_id = ANY($1::bigint[])
      ORDER BY sort, id`,
    [ids],
  );

  const medsByRx = new Map<string, PrescriptionMedicine[]>();
  for (const mr of medRows) {
    const key = String(mr.prescription_id);
    let bucket = medsByRx.get(key);
    if (!bucket) {
      bucket = [];
      medsByRx.set(key, bucket);
    }
    bucket.push(toMedicine(mr));
  }

  // Up to a handful of photos per prescription (migration 0040) — see
  // `PrescriptionImage`'s own doc.
  const imageRows = await query<Row>(
    `SELECT prescription_id, id, image, image_rotation
       FROM app.prescription_image
      WHERE prescription_id = ANY($1::bigint[])
      ORDER BY sort, id`,
    [ids],
  );
  const imagesByRx = new Map<string, PrescriptionImage[]>();
  for (const ir of imageRows) {
    const key = String(ir.prescription_id);
    let bucket = imagesByRx.get(key);
    if (!bucket) {
      bucket = [];
      imagesByRx.set(key, bucket);
    }
    bucket.push({
      id: String(ir.id),
      image: String(ir.image ?? ''),
      rotation: Number(ir.image_rotation ?? 0),
    });
  }

  // Scripts uploaded before migration 0040 carry their one photo directly on
  // `app.prescription.image`/`image_rotation` instead of a `prescription_image`
  // row — never backfilled into the new table, so without this they show as
  // "no image was uploaded" in the console despite the photo being right
  // there. Only fetched for the rows that actually need it (no new-table rows,
  // legacy column non-null): `rx.image` is a 100KB+ base64 string, too heavy
  // to pull for every prescription in the main list query above.
  const legacyIds = rows
    .filter(
      (r) => (imagesByRx.get(String(r.id)) ?? []).length === 0 && r.has_legacy_image,
    )
    .map((r) => String(r.id));
  if (legacyIds.length > 0) {
    const legacyRows = await query<Row>(
      `SELECT id, image, image_rotation FROM app.prescription WHERE id = ANY($1::bigint[])`,
      [legacyIds],
    );
    for (const lr of legacyRows) {
      const key = String(lr.id);
      imagesByRx.set(key, [
        {
          id: `legacy-${key}`,
          image: String(lr.image ?? ''),
          rotation: Number(lr.image_rotation ?? 0),
        },
      ]);
    }
  }

  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    memberId: String(r.member_id ?? ''),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    patientId: String(r.patient_id ?? ''),
    patientName: String(r.patient_name ?? '—'),
    doctor: String(r.doctor ?? ''),
    fileName: String(r.file_name ?? ''),
    images: imagesByRx.get(String(r.id)) ?? [],
    duration: durationLabel(r),
    durationToken: r.duration ? fromEnum(String(r.duration)) : '',
    customDays: num(r.custom_days),
    status: fromEnum<PrescriptionStatus>(String(r.status)),
    storeId: String(r.assigned_store_id ?? ''),
    storeCode: String(r.store_code ?? ''),
    storeName: String(r.store_name ?? '—'),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    medicines: medsByRx.get(String(r.id)) ?? [],
    orderId: r.linked_order_id == null ? '' : String(r.linked_order_id),
    fulfillmentType: fromEnum<FulfillmentType>(
      String(r.order_fulfillment_type ?? 'HOME_DELIVERY'),
    ),
    billAmount: num(r.order_bill_amount),
    billStatus: fromEnum<PaymentStatus>(String(r.order_bill_status ?? 'PENDING')),
  }));
}

/** Every uploaded prescription, across every branch and member. */
export async function listPrescriptions(): Promise<Prescription[]> {
  return fetchPrescriptions();
}

/**
 * One member's own prescriptions — the same rows {@link listPrescriptions}
 * would show for them, scoped server-side. Used by the "Prescriptions" tab
 * on the user detail page, so reviewing one member's scripts (and sending or
 * updating their intake card) does not need a trip to the app-wide queue.
 */
export async function listPrescriptionsForMember(
  memberId: string,
): Promise<Prescription[]> {
  return fetchPrescriptions(memberId);
}

/**
 * The medicines on whichever prescription [orderId] was billed against —
 * `BillEditorModal`'s source for offering a prescription order's real
 * intake list (name, pack, quantity, stock status) as bill-line candidates,
 * instead of a blank form. A focused query rather than {@link fetchPrescriptions}
 * — no images, patient, or doctor details, none of which a bill needs.
 *
 * Null when [orderId] has no linked prescription at all (a standard order,
 * or a gap); an empty array when it does but nothing was ever added to its
 * intake card.
 */
export async function getPrescriptionMedicinesForOrder(
  orderId: string,
): Promise<PrescriptionMedicine[] | null> {
  const rxRows = await query<Row>(
    `SELECT rx.id
       FROM app.prescription_order po
       JOIN app.prescription rx ON rx.id = po.prescription_id
      WHERE po.order_id = $1
      ORDER BY po.id DESC
      LIMIT 1`,
    [orderId],
  );
  if (rxRows.length === 0) {
    return null;
  }
  const medRows = await query<Row>(
    `SELECT name, pack, dose_morning, dose_afternoon, dose_night, total_units,
            route_time, status
       FROM app.prescription_medicine
      WHERE prescription_id = $1
      ORDER BY sort, id`,
    [rxRows[0].id],
  );
  return medRows.map(toMedicine);
}

export async function setPrescriptionStatus(
  id: string,
  status: PrescriptionStatus,
): Promise<void> {
  const db = status.toUpperCase();
  await query(
    `UPDATE app.prescription
        SET status = $2::app.prescription_status,
            reviewed_at = CASE WHEN $2 <> 'AWAITING_REVIEW' AND reviewed_at IS NULL
                               THEN now() ELSE reviewed_at END
      WHERE id = $1`,
    [id, db],
  );
}

/**
 * Corrects what the member sent up front — the doctor's name (blank until a
 * reviewer reads it off the script) and how long the course runs, either one
 * of the five fixed spans or a reviewer's own day count. [customDays] above
 * 0 is what [Prescription.duration] actually displays; 0 clears it back to
 * plain [durationToken].
 */
export async function updatePrescriptionDetails(
  id: string,
  opts: { doctor: string; durationToken: string; customDays: number },
): Promise<void> {
  await query(
    `UPDATE app.prescription
        SET doctor = $2,
            duration = $3::app.medicine_duration,
            custom_days = $4,
            updated_at = now()
      WHERE id = $1`,
    [
      id,
      opts.doctor.trim(),
      opts.durationToken.trim() ? opts.durationToken.toUpperCase() : null,
      Math.max(0, Math.round(opts.customDays) || 0),
    ],
  );
}

/**
 * Pins (or clears) the branch this prescription is filled at —
 * `app.prescription.store_id` directly, overriding the pickup-order /
 * home-branch fallback {@link fetchPrescriptions} otherwise falls back to for
 * [Prescription.storeCode] / [Prescription.storeName]. `null` clears it back
 * to that fallback chain.
 */
export async function updatePrescriptionBranch(
  id: string,
  storeId: string | null,
): Promise<void> {
  await query(
    `UPDATE app.prescription SET store_id = $2, updated_at = now() WHERE id = $1`,
    [id, storeId],
  );
}

/**
 * Re-points this prescription at a different saved patient of the same
 * member — `app.prescription.patient_id` — for when the wrong family member
 * was picked at upload, or the right one hadn't been added yet. The picker
 * this feeds only ever offers that member's own patients (or a freshly
 * created one), so [patientId] is trusted as already scoped to them.
 */
export async function updatePrescriptionPatient(
  id: string,
  patientId: string,
): Promise<void> {
  await query(
    `UPDATE app.prescription SET patient_id = $2, updated_at = now() WHERE id = $1`,
    [id, patientId],
  );
}

/**
 * Fixes one image's display rotation (a script photographed sideways or
 * upside down is common enough to need this) — permanently, not just for
 * the reviewer's own look: the next person to open this prescription sees
 * it rotated the same way. [imageId] is one row of `app.prescription_image`
 * (migration 0040) — per image, not per prescription, since only one page
 * of a multi-page script may need fixing. A `legacy-<id>` id (see
 * `fetchPrescriptions`'s own doc) has no such row to update — it's the
 * pre-migration `app.prescription.image_rotation` column instead.
 */
export async function setPrescriptionImageRotation(
  imageId: string,
  degrees: 0 | 90 | 180 | 270,
): Promise<void> {
  const legacyMatch = imageId.match(/^legacy-(\d+)$/);
  if (legacyMatch) {
    await query(
      `UPDATE app.prescription SET image_rotation = $2 WHERE id = $1`,
      [legacyMatch[1], degrees],
    );
    return;
  }
  await query(
    `UPDATE app.prescription_image SET image_rotation = $2 WHERE id = $1`,
    [imageId, degrees],
  );
}

/** "101" / "1-0-1" → [1, 0, 1]. Non-digits are dropped; short/long codes pad
 *  or truncate to three so a half-typed row still saves something sane. */
function intakeDigits(code: string): [number, number, number] {
  const d = (code.match(/\d/g) ?? []).slice(0, 3).map(Number);
  while (d.length < 3) d.push(0);
  return [d[0], d[1], d[2]];
}

/**
 * Replaces a prescription's intake card with the lines the pharmacist entered
 * and moves the row to `READ` — the customer app picks the card up on its next
 * read and expands it.
 *
 * Blank rows (no name) are dropped. Sending an empty list clears the card and
 * leaves the row at whatever status it was.
 */
export async function savePrescriptionIntake(
  id: string,
  medicines: PrescriptionMedicineInput[],
): Promise<void> {
  const rows = medicines
    .map((m) => ({ ...m, name: m.name.trim() }))
    .filter((m) => m.name.length > 0);

  await query('DELETE FROM app.prescription_medicine WHERE prescription_id = $1', [
    id,
  ]);

  for (let i = 0; i < rows.length; i += 1) {
    const [morning, afternoon, night] = intakeDigits(rows[i].intake);
    await query(
      `INSERT INTO app.prescription_medicine
         (prescription_id, sort, name, pack,
          dose_morning, dose_afternoon, dose_night, total_units, route_time,
          status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::app.prescription_medicine_status)`,
      [
        id,
        i,
        rows[i].name,
        rows[i].pack.trim(),
        morning,
        afternoon,
        night,
        Math.max(0, Math.round(rows[i].totalUnits) || 0),
        rows[i].routeTime.trim(),
        toEnum(rows[i].status || 'available'),
      ],
    );
  }

  if (rows.length > 0) {
    await query(
      `UPDATE app.prescription
          SET status = 'READ'::app.prescription_status,
              reviewed_at = COALESCE(reviewed_at, now()),
              updated_at = now()
        WHERE id = $1`,
      [id],
    );
  }
}

/**
 * Admin recovery only — not the normal path. Every prescription is meant
 * to already carry the `app."order"` (kind `PRESCRIPTION`) the member's own
 * checkout created alongside it (see `Prescription.orderId`'s own doc:
 * "shouldn't happen once uploaded via checkout"); this exists for the rare
 * one that somehow doesn't, so "Convert to bill" has something to convert
 * instead of refusing outright. Uses exactly the fields already confirmed
 * right there on the Details step — the member, the pinned branch, the
 * fulfilment type shown — rather than inventing anything a reviewer
 * hasn't already set. Returns the new order's id.
 */
export async function createOrderForPrescription(
  prescriptionId: string,
  fulfillmentType: 'HOME_DELIVERY' | 'STORE_PICKUP',
): Promise<string> {
  const rows = await query<{ id: unknown }>(
    `INSERT INTO app."order" (member_id, code, kind, status, store_id, fulfillment_type, item_count)
     SELECT rx.member_id, 'SH-TMP-' || substr(gen_random_uuid()::text, 1, 8),
            'PRESCRIPTION'::app.order_kind, 'PROCESSING'::app.order_status,
            rx.store_id, $2::app.fulfillment_type, 1
       FROM app.prescription rx
      WHERE rx.id = $1
     RETURNING id`,
    [prescriptionId, fulfillmentType],
  );
  if (!rows.length) {
    throw new Error('Could not create an order for this prescription.');
  }
  const orderId = String(rows[0].id);
  // A real, stable code now that the row's own id exists to build it from
  // — the placeholder above only ever has to satisfy the NOT NULL UNIQUE
  // constraint for the instant between these two statements.
  await query('UPDATE app."order" SET code = $2 WHERE id = $1', [
    orderId,
    `SH-${orderId}`,
  ]);
  await query(
    `INSERT INTO app.prescription_order (prescription_id, order_id, store_id, status)
     SELECT $1, $2, rx.store_id, 'SUBMITTED'
       FROM app.prescription rx
      WHERE rx.id = $1`,
    [prescriptionId, orderId],
  );
  return orderId;
}
