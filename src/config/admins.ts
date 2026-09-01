import type { AdminUser, Role } from '@/types';

/**
 * Preset admin logins for the console.
 *
 * The console authenticates against this list directly — no Firebase, no
 * database round-trip. A login is a short id + password, not an email. Edit the
 * rows to change who can sign in, their role, and (for a pharmacy) their branch.
 *
 * This file is bundled into the shipped JS — like `VITE_DATABASE_URL` already
 * is — so the console must only ever be deployed somewhere staff-only. Change
 * every password below before handing the console to anyone.
 *
 * `storeCode` must be a seeded `app.shield_store.code` (e.g. `SHD-MEL`); it is
 * required for `role: 'pharmacy'` and ignored for every other role.
 */
export interface AdminCredential {
  /** What the admin types in the Login ID field. Case-insensitive. */
  loginId: string;
  password: string;
  name: string;
  role: Role;
  /** Required for `pharmacy` — the one branch that admin works. */
  storeCode?: string;
  /** Optional avatar tint; a per-role default is used when omitted. */
  avatarColor?: string;
}

export const ADMIN_CREDENTIALS: AdminCredential[] = [
  // ---- Cross-branch roles -------------------------------------------------
  {
    loginId: 'superadmin',
    password: 'Shield@Super#2026',
    name: 'Super Admin',
    role: 'superadmin',
  },
  {
    loginId: 'lab',
    password: 'Shield@Lab#2026',
    name: 'Lab Admin',
    role: 'lab',
  },
  {
    loginId: 'appointments',
    password: 'Shield@Appt#2026',
    name: 'Appointments Admin',
    role: 'appointments',
  },

  // ---- One pharmacy login per branch -----------------------------------
  {
    loginId: 'pharmacy_mel',
    password: 'Shield@MEL#2026',
    name: 'Melattur Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-MEL',
  },
  {
    loginId: 'pharmacy_mkp',
    password: 'Shield@MKP#2026',
    name: 'Makkaraparamba Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-MKP',
  },
  {
    loginId: 'pharmacy_tir',
    password: 'Shield@TIR#2026',
    name: 'Tirur Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-TIR',
  },
  {
    loginId: 'pharmacy_kkt',
    password: 'Shield@KKT#2026',
    name: 'Karinkallathani Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-KKT',
  },
  {
    loginId: 'pharmacy_mjr',
    password: 'Shield@MJR#2026',
    name: 'Manjery Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-MJR',
  },
  {
    loginId: 'pharmacy_aln',
    password: 'Shield@ALN#2026',
    name: 'Alanallur Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-ALN',
  },
  {
    loginId: 'pharmacy_trd',
    password: 'Shield@TRD#2026',
    name: 'Tirurangadi Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-TRD',
  },
  {
    loginId: 'pharmacy_knp',
    password: 'Shield@KNP#2026',
    name: 'Kunnumpuram Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-KNP',
  },
  {
    loginId: 'pharmacy_knd',
    password: 'Shield@KND#2026',
    name: 'Kondotty Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-KND',
  },
  {
    loginId: 'pharmacy_ark',
    password: 'Shield@ARK#2026',
    name: 'Areekode Pharmacy',
    role: 'pharmacy',
    storeCode: 'SHD-ARK',
  },
];

const ROLE_COLOR: Record<Role, string> = {
  superadmin: '#2c57a6',
  pharmacy: '#1f7a4d',
  lab: '#8a5b1f',
  appointments: '#6b3fa0',
};

function toAdminUser(c: AdminCredential): AdminUser {
  const loginId = c.loginId.trim().toLowerCase();
  return {
    id: loginId,
    firebaseUid: null,
    loginId,
    name: c.name,
    role: c.role,
    avatarColor: c.avatarColor ?? ROLE_COLOR[c.role],
    status: 'active',
    storeCode: c.role === 'pharmacy' ? c.storeCode : undefined,
    lastLogin: new Date().toISOString(),
  };
}

/** Verifies a login id + password against the list → the `AdminUser`, or null. */
export function authenticate(loginId: string, password: string): AdminUser | null {
  const wanted = loginId.trim().toLowerCase();
  const hit = ADMIN_CREDENTIALS.find(
    (c) => c.loginId.trim().toLowerCase() === wanted && c.password === password,
  );
  return hit ? toAdminUser(hit) : null;
}

/** The `AdminUser` for a stored login id, used to restore a session. Null when
 *  the id has since been removed from the list. */
export function adminForLoginId(loginId: string): AdminUser | null {
  const wanted = loginId.trim().toLowerCase();
  const hit = ADMIN_CREDENTIALS.find(
    (c) => c.loginId.trim().toLowerCase() === wanted,
  );
  return hit ? toAdminUser(hit) : null;
}
