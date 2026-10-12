import { api } from '@/lib/api';
import { fromEnum, iso } from '@/lib/mappers';
import type { Appointment, AppointmentStatus, AppointmentType } from '@/types';

type Row = Record<string, unknown>;

/**
 * Care bookings members made in the app. The provider is the clinic or
 * dietitian the booking is against (or the free-text doctor name); the branch
 * is the member's home branch, since `app.appointment` carries no store.
 * Built by backend/api (BookingService.listAppointmentsForStaff) — the
 * browser no longer reads appointments straight from the database.
 */
export async function listAppointments(token: string | null): Promise<Appointment[]> {
  const rows = await api.get<Row[]>('/v1/staff/appointments', token);

  return rows.map((r) => ({
    id: String(r.id),
    memberName: String(r.memberName ?? '—'),
    memberPhone: String(r.memberPhone ?? ''),
    type: fromEnum<AppointmentType>(String(r.kind)),
    providerName: String(r.providerName ?? '—'),
    storeName: String(r.storeName ?? '—'),
    scheduledFor: iso(r.scheduledFor) ?? '',
    status: fromEnum<AppointmentStatus>(String(r.status)),
    notes: String(r.remarks ?? ''),
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
  }));
}

export async function setAppointmentStatus(
  id: string,
  status: AppointmentStatus,
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/appointments/${id}/status`, { status: status.toUpperCase() }, token);
}
