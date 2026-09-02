export type Role = 'superadmin' | 'pharmacy' | 'lab' | 'appointments';

export type ModuleKey =
  | 'dashboard'
  | 'stores'
  | 'products'
  | 'orders'
  | 'prescriptions'
  | 'activations'
  | 'users'
  | 'lab_orders'
  | 'lab_tests'
  | 'appointments'
  | 'admins';

export type AccountStatus = 'active' | 'suspended';

/** A console login — one entry of the preset roster in `src/config/admins.ts`. */
export interface AdminUser {
  id: string;
  /** Unused by the preset-login flow; kept so older code still type-checks. */
  firebaseUid: string | null;
  /** The login id typed at sign-in — a short handle, not an email. */
  loginId: string;
  name: string;
  role: Role;
  avatarColor: string;
  /** `active` / `suspended`. Always `active` for a preset login. */
  status: AccountStatus;
  /** Set only for `pharmacy` — the branch this admin works, e.g. `SHD-MEL`. */
  storeCode?: string;
  lastLogin?: string;
}

/** The signed-in admin kept in context. Same shape as the table row. */
export type AuthUser = AdminUser;

/** A SHIELD branch — one row of `app.shield_store`. */
export interface Store {
  id: string;
  /** Stable branch code, e.g. `SHD-MEL`. */
  code: string;
  name: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  hours: string;
  isActive: boolean;
  /** Members whose home branch this is. */
  memberCount: number;
  /** Orders billed to this branch, all-time. */
  orderCount: number;
  openedAt: string;
}

/** A catalogue product's admin state — mirrors `app.product.status`. */
export type ProductStatus = 'active' | 'inactive';

/** One storefront category group — a row of `app.product_category`. */
export interface ProductCategory {
  id: string;
  slug: string;
  title: string;
}

/** Fields the admin fills to add a product to the catalogue. */
export interface NewProduct {
  categorySlug: string;
  name: string;
  pack: string;
  brand: string;
  code: string;
  price: number;
  mrp: number;
  discountLabel: string;
  isPrescriptionOnly: boolean;
  stockQuantity: number;
  status: ProductStatus;
}

/** One row of `app.product`, joined to its `app.product_category`. */
export interface Product {
  id: string;
  code: string;
  name: string;
  pack: string;
  brand: string;
  categorySlug: string;
  categoryTitle: string;
  price: number;
  mrp: number;
  discountLabel: string;
  isPrescriptionOnly: boolean;
  status: ProductStatus;
  stockQuantity: number;
  addedAt: string;
}

/** `app.order_status`. */
export type OrderStatus =
  | 'processing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

/** `app.order_kind`. */
export type OrderKind = 'standard' | 'prescription';

/** One row of `app.order_line`. */
export interface OrderLine {
  name: string;
  pack: string;
  unitPrice: number;
  mrp: number;
  qty: number;
}

/** A member's order — `app."order"` + `app.order_line`. */
export interface Order {
  id: string;
  code: string;
  memberName: string;
  memberPhone: string;
  kind: OrderKind;
  status: OrderStatus;
  itemCount: number;
  mrpTotal: number;
  paidTotal: number;
  deliveryFee: number;
  storeCode: string;
  storeName: string;
  paymentMethod: string;
  placedAt: string;
  lines: OrderLine[];
}

/** `app.prescription_status`. */
export type PrescriptionStatus =
  | 'awaiting_review'
  | 'read'
  | 'in_cart'
  | 'ordered';

/** One row of `app.prescription_medicine` (dose is morning-afternoon-night). */
export interface PrescriptionMedicine {
  name: string;
  pack: string;
  doseMorning: number;
  doseAfternoon: number;
  doseNight: number;
}

/** An uploaded prescription — `app.prescription` + `app.prescription_medicine`. */
export interface Prescription {
  id: string;
  code: string;
  memberName: string;
  memberPhone: string;
  patientName: string;
  doctor: string;
  fileName: string;
  duration: string;
  status: PrescriptionStatus;
  storeCode: string;
  storeName: string;
  createdAt: string;
  medicines: PrescriptionMedicine[];
}

/** What a member's account currently resolves to across the app + web console. */
export type Persona = 'member' | 'agent' | 'investor';

/** `app.agent_level`, lowercased for the console. */
export type AgentLevel =
  | 'national'
  | 'region'
  | 'state'
  | 'district'
  | 'assembly'
  | 'lsgd'
  | 'ward';

/** `app.investor_plan_type`, lowercased. */
export type InvestorPlanType = 'yearly' | 'monthly';

/**
 * One row of `app.users` — an app member — with whatever persona the Super
 * Admin has granted them (`app.agent` / `app.investor`).
 */
export interface AppUser {
  id: string;
  name: string;
  phone: string;
  email: string;
  registered: boolean;
  homeStoreCode: string;
  homeStoreName: string;
  createdAt: string;
  lastLoginAt: string;
  persona: Persona;
  /** e.g. `SHD-AGT-003`, set when `persona === 'agent'`. */
  agentCode: string;
  agentLevel: AgentLevel | '';
  /** e.g. `SHD-INV-002`, set when `persona === 'investor'`. */
  investorCode: string;
}

/** A pickable parent when converting a user to an agent. */
export interface AgentOption {
  id: string;
  code: string;
  name: string;
  level: AgentLevel;
}

/** `app.lab_booking_status`. */
export type LabBookingStatus =
  | 'requested'
  | 'confirmed'
  | 'sample_collected'
  | 'report_ready'
  | 'cancelled';

/** A member's lab-test booking — one row of `app.lab_booking`. */
export interface LabBooking {
  id: string;
  code: string;
  memberName: string;
  memberPhone: string;
  packageName: string;
  patientsCount: number;
  unitPrice: number;
  totalPrice: number;
  status: LabBookingStatus;
  scheduledFor: string;
  createdAt: string;
}

/** `app.appointment_kind`. */
export type AppointmentType = 'clinic' | 'tele' | 'dental' | 'dietitian';
export type AppointmentStatus =
  | 'requested'
  | 'confirmed'
  | 'completed'
  | 'cancelled';

/** A care booking a member made in the app — one row of `app.appointment`. */
export interface Appointment {
  id: string;
  memberName: string;
  memberPhone: string;
  type: AppointmentType;
  /** Clinic, tele-consult or dietitian the booking is with. */
  providerName: string;
  /** The SHIELD branch serving the member. */
  storeName: string;
  scheduledFor: string;
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
}

/** A diagnostic package — one row of `app.lab_package`. */
export interface LabPackage {
  id: string;
  slug: string;
  name: string;
  testCount: number;
  profileCount: number;
  price: number;
  mrp: number;
  saved: number;
  reportIn: string;
  rating: string;
  booked: string;
  forWhom: string;
  sample: string;
  isActive: boolean;
  addedAt: string;
}

/** `app.approval_status`, as the activations screen uses it. */
export type PrivilegeActivationStatus =
  | 'pending'
  | 'approved'
  | 'partially_approved'
  | 'rejected'
  | 'cancelled';

/**
 * A privilege-plan activation a member submitted from the app — one row of
 * `app.wallet_card`. Lands as `pending`; a Super Admin approves it (which
 * writes the wallet ledger and moves the balance) or rejects it with a note.
 */
export interface PrivilegeActivation {
  id: string;
  uuid: string;
  memberName: string;
  memberPhone: string;
  /** e.g. `Silver Shield`. */
  tier: string;
  /** `silver` · `gold` · `platinum`. */
  tierKind: string;
  /** The load the member paid in. */
  amount: number;
  /** The 10% programme bonus. */
  bonus: number;
  /** What lands on the balance on approval — load + bonus + any recharge. */
  credited: number;
  status: PrivilegeActivationStatus;
  storeCode: string;
  storeName: string;
  cardNumber: string;
  receiptReference: string;
  receiptFileName: string;
  reviewerNote: string;
  submittedAt: string;
  reviewedAt?: string;
}
