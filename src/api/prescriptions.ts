import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type {
  Prescription,
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
  };
}

/**
 * Uploaded prescriptions, newest first. The branch is `app.prescription.store_id`
 * (set by the app at upload), then the branch on the linked
 * `app.prescription_order`, then the member's home branch as a last resort.
 */
export async function listPrescriptions(): Promise<Prescription[]> {
  const rows = (await sql`
    SELECT rx.id, rx.code,
           m.name  AS member_name,
           m.phone AS member_phone,
           pt.name AS patient_name,
           rx.doctor, rx.file_name, rx.image,
           rx.duration, rx.custom_days, rx.status,
           COALESCE(rs.code, os.code, hs.code) AS store_code,
           COALESCE(rs.name, os.name, hs.name) AS store_name,
           rx.created_at
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
    WHERE rx.deleted_at IS NULL
    ORDER BY rx.created_at DESC
  `) as Row[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));
  const medRows = await query<Row>(
    `SELECT prescription_id, name, pack,
            dose_morning, dose_afternoon, dose_night, total_units
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

  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    patientName: String(r.patient_name ?? '—'),
    doctor: String(r.doctor ?? ''),
    fileName: String(r.file_name ?? ''),
    image: String(r.image ?? ''),
    duration: durationLabel(r),
    status: fromEnum<PrescriptionStatus>(String(r.status)),
    storeCode: String(r.store_code ?? ''),
    storeName: String(r.store_name ?? '—'),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    medicines: medsByRx.get(String(r.id)) ?? [],
  }));
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
          dose_morning, dose_afternoon, dose_night, total_units)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        i,
        rows[i].name,
        rows[i].pack.trim(),
        morning,
        afternoon,
        night,
        Math.max(0, Math.round(rows[i].totalUnits) || 0),
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
