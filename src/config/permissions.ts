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
    description: 'Sahakar 360 branches & coverage',
  },
  {
    key: 'products',
    label: 'Catalogue',
    path: '/products',
    icon: 'products',
    description: 'Storefront & pharmacy shelf',
  },
  {
    key: 'banners',
    label: 'Banners',
    path: '/banners',
    icon: 'banners',
    description: 'Home hero banner & per-category banners',
  },
  {
    key: 'customer_videos',
    label: 'Customer Videos',
    path: '/customer-videos',
    icon: 'videos',
    description: '"What our customers have to say" video reel',
  },
  {
    key: 'orders',
    label: 'Orders',
    path: '/orders',
    icon: 'orders',
    description: 'Member orders & fulfilment',
  },
  {
    key: 'bills',
    label: 'Bills',
    path: '/bills',
    icon: 'receipt',
    description: 'Invoices sent back to members, across every branch',
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
    label: 'Health Pass plan approvals',
    path: '/activations',
    icon: 'wallet',
    description: 'Health Pass plan activations awaiting approval',
  },
  {
    key: 'agent_approvals',
    label: 'Agent approvals',
    path: '/agent-approvals',
    icon: 'users',
    description: 'New agents awaiting a position & approval',
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
    key: 'accounts',
    label: 'Accounts',
    path: '/accounts',
    icon: 'accounts',
    description: 'Total money flow — revenue in, payouts out',
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
  {
    key: 'deliveries',
    label: 'Deliveries',
    path: '/deliveries',
    icon: 'deliveries',
    description: 'Cash order handoff & delivery boys',
  },
  {
    key: 'commission_reserve',
    label: 'Reserved',
    path: '/commission-reserve',
    icon: 'accounts',
    description: "The company's own share of every Health Pass activation (8%)",
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
  'banners',
  'customer_videos',
  'orders',
  'bills',
  'prescriptions',
  'activations',
  'agent_approvals',
  'users',
  'lab_orders',
  'lab_tests',
  'appointments',
  'accounts',
  'deliveries',
];

export const ROLE_PERMISSIONS: Record<Role, ModuleKey[]> = {
  // 'commission_reserve' is deliberately not in APP_MODULES (which admin
  // gets too) — it's the company's own share of every agent commission
  // split, not something an Admin reviewing activations needs to see.
  superadmin: [...APP_MODULES, 'admins', 'commission_reserve'],
  admin: [...APP_MODULES],
  pharmacy: ['dashboard', 'orders', 'bills', 'prescriptions', 'products', 'deliveries'],
  lab: ['dashboard', 'stores', 'lab_orders', 'lab_tests'],
  appointments: ['dashboard', 'appointments'],
  delivery: ['dashboard', 'deliveries'],
};

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  pharmacy: 'Pharmacy Admin',
  lab: 'Lab Admin',
  appointments: 'Appointments Admin',
  delivery: 'Delivery',
};

export const ROLE_SUMMARY: Record<Role, string> = {
  superadmin:
    'The whole view — every module, plus the Admins module that controls who can sign in.',
  admin:
    'Runs the app: catalogue, users & agent / investor conversion, orders, bills, prescriptions, privilege plans, labs, appointments and the Accounts money-flow view.',
  pharmacy: 'Works one branch — its member orders, bills and uploaded prescriptions.',
  lab: 'Works member lab-test bookings — schedule, notes and reports — the test master and package catalogue, and the branch list.',
  appointments: 'Handles the clinic, tele and dietitian appointment queue.',
  delivery: "Delivers and collects cash for their branch's cash orders.",
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

/**
 * Approving an agent — setting their level/position and letting them work — is
 * for the app managers (Super Admin and Admin), the same as privilege-plan
 * activations.
 */
export function canApproveAgents(role: Role): boolean {
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
