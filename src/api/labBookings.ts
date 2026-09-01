import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type { LabBooking, LabBookingStatus } from '@/types';

type Row = Record<string, unknown>;

/**
 * Member lab-test bookings, newest first. `app.lab_booking` has no `code`
 * column, so a stable `LB-0001` label is derived from the id.
 */
export async function listLabBookings(): Promise<LabBooking[]> {
  const rows = (await sql`
    SELECT lb.id,
           'LB-' || lpad(lb.id::text, 4, '0') AS code,
           m.name  AS member_name,
           m.phone AS member_phone,
           lp.name AS package_name,
           lb.patients_count, lb.unit_price, lb.total_price, lb.status,
           lb.scheduled_for, lb.created_at
    FROM app.lab_booking lb
    LEFT JOIN app.users m       ON m.id  = lb.member_id
    LEFT JOIN app.lab_package lp ON lp.id = lb.lab_package_id
    ORDER BY lb.created_at DESC
  `) as Row[];

  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    packageName: String(r.package_name ?? '—'),
    patientsCount: num(r.patients_count),
    unitPrice: num(r.unit_price),
    totalPrice: num(r.total_price),
    status: fromEnum<LabBookingStatus>(String(r.status)),
    scheduledFor: iso(r.scheduled_for) ?? '',
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  }));
}

export async function setLabBookingStatus(
  id: string,
  status: LabBookingStatus,
): Promise<void> {
  await query(
    'UPDATE app.lab_booking SET status = $2::app.lab_booking_status WHERE id = $1',
    [id, status.toUpperCase()],
  );
}
