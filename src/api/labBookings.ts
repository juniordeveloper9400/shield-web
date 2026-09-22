import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type {
  LabBooking,
  LabBookingPatient,
  LabBookingStatus,
  LabReportPage,
} from '@/types';

type Row = Record<string, unknown>;

function toPatients(value: unknown): LabBookingPatient[] {
  if (!Array.isArray(value)) return [];
  return value.map((p) => {
    const item = (p ?? {}) as Row;
    const age = item.age == null ? null : Number(item.age);
    return {
      name: String(item.name ?? '').trim() || 'Patient',
      age: age !== null && Number.isFinite(age) ? age : null,
    };
  });
}

/**
 * Member lab-test bookings, newest first. `app.lab_booking` has no `code`
 * column, so a stable `LB-0001` label is derived from the id.
 *
 * Report pages are only *counted* here — each is a large image, fetched one
 * booking at a time by [listLabReportPages] when its Manage window opens.
 */
export async function listLabBookings(): Promise<LabBooking[]> {
  const rows = (await sql`
    SELECT lb.id,
           'LB-' || lpad(lb.id::text, 4, '0') AS code,
           m.name  AS member_name,
           m.phone AS member_phone,
           lp.name AS package_name,
           s.code AS store_code, s.name AS store_name,
           lb.patients_count, lb.unit_price, lb.total_price, lb.status,
           lb.scheduled_for, lb.note, lb.report_uploaded_at, lb.created_at,
           concat_ws(', ',
             NULLIF(btrim(ma.house), ''),
             NULLIF(btrim(ma.area), ''),
             NULLIF(btrim(ma.landmark), ''),
             NULLIF(btrim(ma.city), ''),
             NULLIF(btrim(ma.state), ''),
             NULLIF(btrim(ma.pincode), '')
           ) AS address,
           ma.phone AS address_phone,
           (SELECT COALESCE(json_agg(json_build_object(
                     'name', COALESCE(NULLIF(btrim(lbp.name), ''), p.name),
                     'age',  COALESCE(lbp.age,
                               CASE WHEN p.dob IS NULL THEN NULL
                                    ELSE date_part('year', age(p.dob))::int END)
                   ) ORDER BY lbp.id), '[]'::json)
              FROM app.lab_booking_patient lbp
              LEFT JOIN app.patient p ON p.id = lbp.patient_id
             WHERE lbp.lab_booking_id = lb.id) AS patients,
           (SELECT count(*)::int
              FROM app.lab_booking_report r
             WHERE r.lab_booking_id = lb.id) AS report_pages
    FROM app.lab_booking lb
    LEFT JOIN app.users m           ON m.id  = lb.member_id
    LEFT JOIN app.lab_package lp    ON lp.id = lb.lab_package_id
    LEFT JOIN app.member_address ma ON ma.id = lb.address_id
    LEFT JOIN app.shield_store s    ON s.id  = lb.store_id
    ORDER BY lb.created_at DESC
  `) as Row[];

  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    packageName: String(r.package_name ?? '—'),
    storeCode: String(r.store_code ?? ''),
    storeName: String(r.store_name ?? ''),
    patientsCount: num(r.patients_count),
    patients: toPatients(r.patients),
    address: String(r.address ?? ''),
    addressPhone: String(r.address_phone ?? ''),
    unitPrice: num(r.unit_price),
    totalPrice: num(r.total_price),
    status: fromEnum<LabBookingStatus>(String(r.status)),
    scheduledFor: iso(r.scheduled_for) ?? '',
    note: String(r.note ?? ''),
    reportPages: num(r.report_pages),
    reportUploadedAt: iso(r.report_uploaded_at) ?? '',
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  }));
}

/**
 * Moves a booking to [status]. "Report ready" is refused unless at least one
 * report page is attached — the member is told a report is waiting, so it
 * must be — enforced in the statement itself, not just by a disabled button.
 */
export async function setLabBookingStatus(
  id: string,
  status: LabBookingStatus,
): Promise<void> {
  const rows = await query<Row>(
    `
    UPDATE app.lab_booking
       SET status = $2::app.lab_booking_status, updated_at = now()
     WHERE id = $1
       AND ($2::app.lab_booking_status <> 'REPORT_READY'
            OR EXISTS (SELECT 1 FROM app.lab_booking_report WHERE lab_booking_id = $1))
    RETURNING id
    `,
    [id, status.toUpperCase()],
  );
  if (rows.length === 0) {
    throw new Error(
      status === 'report_ready'
        ? 'Attach the report pages before marking this booking Report ready.'
        : 'That booking could not be updated.',
    );
  }
}

/**
 * The lab's edit of a booking: when it is scheduled for and the note shown to
 * the member. A blank date clears the schedule. Cancelled bookings, and dates
 * on a finished (Report ready) one, are left alone.
 */
export async function updateLabBookingDetails(
  id: string,
  input: { scheduledFor: string | null; note: string },
): Promise<void> {
  const note = input.note.trim();
  await query(
    `
    UPDATE app.lab_booking
       SET note = $2,
           scheduled_for = CASE WHEN status = 'REPORT_READY'
                                THEN scheduled_for ELSE $3::timestamptz END,
           updated_at = now()
     WHERE id = $1 AND status <> 'CANCELLED'
    `,
    [id, note || null, input.scheduledFor],
  );
}

/** The pages of one booking's report, in order. Heavy — call it per booking. */
export async function listLabReportPages(id: string): Promise<LabReportPage[]> {
  const rows = await query<Row>(
    `
    SELECT id, name, image
      FROM app.lab_booking_report
     WHERE lab_booking_id = $1
     ORDER BY sort, id
    `,
    [id],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    image: String(r.image ?? ''),
  }));
}

/**
 * Attaches [pages] (already resized to JPEG data URIs) after the ones already
 * there, and stamps when the report was last touched.
 */
export async function addLabReportPages(
  id: string,
  pages: { name: string; image: string }[],
): Promise<void> {
  if (pages.length === 0) return;
  for (const page of pages) {
    await query(
      `
      INSERT INTO app.lab_booking_report (lab_booking_id, name, image, sort)
      VALUES ($1, $2, $3,
        (SELECT COALESCE(MAX(sort), -1) + 1
           FROM app.lab_booking_report WHERE lab_booking_id = $1))
      `,
      [id, page.name, page.image],
    );
  }
  await query(
    `UPDATE app.lab_booking SET report_uploaded_at = now(), updated_at = now() WHERE id = $1`,
    [id],
  );
}

/**
 * Removes one report page. A booking already marked Report ready keeps its
 * last page — the statement refuses to take it, so the member is never left
 * with a "ready" report that is empty.
 */
export async function removeLabReportPage(
  bookingId: string,
  pageId: string,
): Promise<void> {
  const rows = await query<Row>(
    `
    DELETE FROM app.lab_booking_report r
     WHERE r.id = $2 AND r.lab_booking_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM app.lab_booking lb
          WHERE lb.id = $1
            AND (lb.status = 'CANCELLED'
                 OR (lb.status = 'REPORT_READY'
                     AND (SELECT count(*) FROM app.lab_booking_report
                           WHERE lab_booking_id = $1) <= 1)))
    RETURNING r.id
    `,
    [bookingId, pageId],
  );
  if (rows.length === 0) {
    throw new Error(
      'That page could not be removed — a Report ready booking keeps at least one page.',
    );
  }
  await query(
    `
    UPDATE app.lab_booking
       SET report_uploaded_at = CASE
             WHEN EXISTS (SELECT 1 FROM app.lab_booking_report WHERE lab_booking_id = $1)
             THEN now() ELSE NULL END,
           updated_at = now()
     WHERE id = $1
    `,
    [bookingId],
  );
}
