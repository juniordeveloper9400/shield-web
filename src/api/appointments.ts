import { sql, query } from '@/lib/db';
import { fromEnum, iso } from '@/lib/mappers';
import type { Appointment, AppointmentStatus, AppointmentType } from '@/types';

type Row = Record<string, unknown>;

/**
 * Care bookings members made in the app. The provider is the clinic or
 * dietitian the booking is against (or the free-text doctor name); the branch
 * is the member's home branch, since `app.appointment` carries no store.
 */
export async function listAppointments(): Promise<Appointment[]> {
  const rows = (await sql`
    SELECT ap.id,
           m.name  AS member_name,
           m.phone AS member_phone,
           ap.kind,
           COALESCE(c.name, d.name, ap.doctor_name, 'SHIELD Tele-Consult') AS provider_name,
           s.name AS store_name,
           ap.scheduled_for, ap.status, ap.remarks, ap.created_at
    FROM app.appointment ap
    LEFT JOIN app.users m       ON m.id = ap.member_id
    LEFT JOIN app.clinic c       ON c.id = ap.clinic_id
    LEFT JOIN app.dietitian d    ON d.id = ap.dietitian_id
    LEFT JOIN app.shield_store s ON s.id = m.home_store_id
    ORDER BY ap.created_at DESC
  `) as Row[];

  return rows.map((r) => ({
    id: String(r.id),
    memberName: String(r.member_name ?? '—'),
    memberPhone: String(r.member_phone ?? ''),
    type: fromEnum<AppointmentType>(String(r.kind)),
    providerName: String(r.provider_name ?? '—'),
    storeName: String(r.store_name ?? '—'),
    scheduledFor: iso(r.scheduled_for) ?? '',
    status: fromEnum<AppointmentStatus>(String(r.status)),
    notes: String(r.remarks ?? ''),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  }));
}

export async function setAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<void> {
  await query(
    'UPDATE app.appointment SET status = $2::app.appointment_status WHERE id = $1',
    [id, status.toUpperCase()],
  );
}
