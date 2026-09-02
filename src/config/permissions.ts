import type { IconName } from '@/components/ui/Icon';
import type { AuthUser, ModuleKey, Role } from '@/types';

export interface NavItem {
  key: ModuleKey;
  label: string;
  path: string;
  icon: IconName;
  description: string;
}

/** Every module in the admin console, in sidebar order. */
export const MODULES: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    path: '/dashboard',
    icon: 'dashboard',
    description: 'Overview & items that need attention',
  },
  {
    key: 'stores',
    label: 'Stores',
    path: '/stores',
    icon: 'stores',
    description: 'SHIELD branches & coverage',
  },
  {
    key: 'products',
    label: 'Catalogue',
    path: '/products',
    icon: 'products',
    description: 'Storefront & pharmacy shelf',
  },
  {
    key: 'orders',
    label: 'Orders',
    path: '/orders',
    icon: 'orders',
    description: 'Member orders & fulfilment',
  },
  {
    key: 'prescriptions',
    label: 'Prescriptions',
    path: '/prescriptions',
    icon: 'prescriptions',
    description: 'Uploaded scripts awaiting the counter',
  },
  {
    key: 'activations',
    label: 'Privilege plans',
    path: '/activations',
    icon: 'wallet',
    description: 'Privilege-plan activations awaiting approval',
  },
  {
    key: 'lab_orders',
    label: 'Lab Orders',
    path: '/lab-orders',
    icon: 'labs',
    description: 'Member lab-test bookings',
  },
  {
    key: 'lab_tests',
    label: 'Lab Tests',
    path: '/lab-tests',
    icon: 'labs',
    description: 'Diagnostic packages',
  },
  {
    key: 'appointments',
    label: 'Appointments',
    path: '/appointments',
    icon: 'appointments',
    description: 'Clinic, tele & dietitian bookings',
  },
  {
    key: 'users',
    label: 'Users',
    path: '/users',
    icon: 'users',
    description: 'App members & agent / investor conversion',
  },
  {
    key: 'admins',
    label: 'Admins',
    path: '/admins',
    icon: 'admins',
    description: 'Admin accounts & their access',
  },
];

/**
 * Which modules each login role may open. The router uses this to decide
 * whether a page renders or redirects to "No access".
 */
/** Every operational module — what an `admin` runs. `superadmin` gets this
 *  plus `admins`. Keep the two in step. */
const APP_MODULES: ModuleKey[] = [
  'dashboard',
  'stores',
  'products',
  'orders',
  'prescriptions',
  'activations',
  'users',
  'lab_orders',
  'lab_tests',
  'appointments',
];

export const ROLE_PERMISSIONS: Record<Role, ModuleKey[]> = {
  superadmin: [...APP_MODULES, 'admins'],
  admin: [...APP_MODULES],
  pharmacy: ['dashboard', 'orders', 'prescriptions', 'products'],
  lab: ['dashboard', 'lab_orders', 'lab_tests'],
  appointments: ['dashboard', 'appointments'],
};

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  pharmacy: 'Pharmacy Admin',
  lab: 'Lab Admin',
  appointments: 'Appointments Admin',
};

export const ROLE_SUMMARY: Record<Role, string> = {
  superadmin:
    'The whole view — every module, plus the Admins module that controls who can sign in.',
  admin:
    'Runs the app: catalogue, users & agent / investor conversion, orders, prescriptions, privilege plans, labs and appointments.',
  pharmacy: 'Works one branch — its member orders and uploaded prescriptions.',
  lab: 'Handles member lab-test bookings and the package catalogue.',
  appointments: 'Handles the clinic, tele and dietitian appointment queue.',
};

export function canAccess(role: Role, moduleKey: ModuleKey): boolean {
  return ROLE_PERMISSIONS[role]?.includes(moduleKey) ?? false;
}

/**
 * Deciding a privilege-plan activation (approve / reject) is for the app
 * managers — Super Admin and Admin. Pharmacy Admins can open the queue to
 * track their branch's submissions, but the approve/reject controls are
 * theirs to view, not use.
 */
export function canReviewActivations(role: Role): boolean {
  return role === 'superadmin' || role === 'admin';
}

export function allowedModules(role: Role): NavItem[] {
  return MODULES.filter((m) => canAccess(role, m.key));
}

/** Where a role lands right after signing in. */
export function landingPath(role: Role): string {
  return allowedModules(role)[0]?.path ?? '/dashboard';
}

/**
 * Narrows branch-bound rows to the signed-in admin's store. A Pharmacy Admin
 * carries a `storeCode` and only ever sees that branch; every other role
 * (Super Admin included) sees all rows.
 */
export function scopeToStore<T extends { storeCode: string }>(
  rows: T[],
  user: Pick<AuthUser, 'role' | 'storeCode'> | null,
): T[] {
  if (user?.role === 'pharmacy' && user.storeCode) {
    return rows.filter((row) => row.storeCode === user.storeCode);
  }
  return rows;
}
