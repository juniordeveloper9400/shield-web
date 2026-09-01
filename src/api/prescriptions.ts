import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type {
  Prescription,
  PrescriptionMedicine,
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
           rx.doctor, rx.file_name, rx.duration, rx.custom_days, rx.status,
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
    `SELECT prescription_id, name, pack, dose_morning, dose_afternoon, dose_night
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
