import { api } from '@/lib/api';
import type { Role } from '@/types';

/** A `GET`/`POST`/`PATCH /v1/staff/admins` row — real staff accounts from
 *  backend/api (`app.admin_user`), not a static roster. Shared by
 *  AdminsPage (every login, console-wide) and StoresPage's own per-branch
 *  "Staff logins" table (narrowed to one store). */
export interface StaffAccount {
  id: string;
  loginId: string;
  name: string;
  role: Role;
  storeId: number | null;
  storeCode: string | null;
  isActive: boolean;
}

interface StaffApiRow {
  id: number;
  loginId: string;
  name: string;
  role: 'SUPERADMIN' | 'ADMIN' | 'PHARMACY' | 'LAB' | 'APPOINTMENTS' | 'DELIVERY' | 'LAB_TECHNICIAN';
  storeId: number | null;
  storeCode: string | null;
  isActive: boolean;
}

function toStaffAccount(r: StaffApiRow): StaffAccount {
  return {
    id: String(r.id),
    loginId: r.loginId,
    name: r.name,
    role: r.role.toLowerCase() as Role,
    storeId: r.storeId,
    storeCode: r.storeCode,
    isActive: r.isActive,
  };
}

/** Every staff login, or just one store's own (SUPERADMIN/ADMIN only — see
 *  admin.controller.ts's own doc on what ADMIN can and can't do here). */
export function listStaffAccounts(token: string | null, storeId?: number): Promise<StaffAccount[]> {
  const qs = storeId !== undefined ? `?storeId=${storeId}` : '';
  return api.get<StaffApiRow[]>(`/v1/staff/admins${qs}`, token).then((rows) => rows.map(toStaffAccount));
}

export function createStaffAccount(
  token: string | null,
  dto: { loginId: string; name: string; password: string; role: Role; storeId?: number },
): Promise<StaffAccount> {
  return api
    .post<StaffApiRow>(
      '/v1/staff/admins',
      { ...dto, role: dto.role.toUpperCase() },
      token,
    )
    .then(toStaffAccount);
}

/** Partial update — only the fields present in [dto] are changed. `password`
 *  omitted (or not passed) leaves the existing one as is; `storeId: null`
 *  clears a branch (for moving an account off the branch-bound roles). */
export function updateStaffAccount(
  token: string | null,
  id: string,
  dto: Partial<{
    loginId: string;
    name: string;
    password: string;
    role: Role;
    storeId: number | null;
    isActive: boolean;
  }>,
): Promise<StaffAccount> {
  const body: Record<string, unknown> = { ...dto };
  if (dto.role) body.role = dto.role.toUpperCase();
  return api.patch<StaffApiRow>(`/v1/staff/admins/${id}`, body, token).then(toStaffAccount);
}
