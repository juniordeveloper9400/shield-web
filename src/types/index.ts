/**
 * Console login roles.
 *
 * - `superadmin` — the whole view: every module, plus the Admins module that
 *   controls who can sign in. Oversight.
 * - `admin` — runs the app: catalogue, users (incl. agent / investor
 *   conversion), orders, prescriptions, privilege plans, labs, appointments.
 *   Everything `superadmin` can reach except the Admins module.
 * - `pharmacy` / `lab` / `appointments` — one desk each, branch-scoped where
 *   it applies.
 * - `delivery` — a delivery boy's own login. Branch-scoped like `pharmacy`;
 *   only sees orders assigned to them or open for pickup at their branch.
 */
export type Role =
  | 'superadmin'
  | 'admin'
  | 'pharmacy'
  | 'lab'
  | 'appointments'
  | 'delivery';

export type ModuleKey =
  | 'dashboard'
  | 'stores'
  | 'products'
  | 'banners'
  | 'customer_videos'
  | 'orders'
  | 'bills'
  | 'prescriptions'
  | 'activations'
  | 'agent_approvals'
  | 'agent_withdrawals'
  | 'users'
  | 'lab_orders'
  | 'lab_tests'
  | 'appointments'
  | 'accounts'
  | 'admins'
  | 'deliveries'
  | 'commission_reserve';

export type AccountStatus = 'active' | 'suspended';

/**
 * A signed-in console user — backed by a real `app.admin_user` row via
 * backend/api (see backend/docs/), not the preset roster this used to be.
 * Signs in with email + password, checked server-side — no Firebase
 * involved for staff.
 */
export interface AdminUser {
  id: string;
  /** The email used to sign in. */
  loginId: string;
  name: string;
  role: Role;
  avatarColor: string;
  status: AccountStatus;
  /** Set only for `pharmacy` — the branch this admin works, e.g. `SHD-MEL`. */
  storeCode?: string;
  lastLogin?: string;
}

/** The signed-in admin kept in context. Same shape as the table row. */
export type AuthUser = AdminUser;

/** A Sahakar 360 branch — one row of `app.shield_store`. */
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
  /** Migration 0057 — whether this branch takes lab bookings. On by default;
   *  a branch with no phlebotomist can be switched off, which drops it from
   *  the app's own branch picker at lab checkout. */
  offersLabCollection: boolean;
  /** Town-centre coordinates. Null until pinned; the app then falls back to
   *  pincode ranking for this branch. */
  latitude: number | null;
  longitude: number | null;
  /** A pasted Google Maps share link for the shopfront. Blank until set;
   *  the detail view and the app show an "Open in Maps" action when present. */
  mapsUrl: string;
  /** Settlement account for this branch. All four are blank until entered. */
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  /** Members whose home branch this is. */
  memberCount: number;
  /** Orders billed to this branch, all-time. */
  orderCount: number;
  openedAt: string;
}

/** Fields the admin fills to open a new Sahakar 360 branch. */
export interface NewStore {
  /** `SHD-…` — unique. Uppercased and trimmed on save. */
  code: string;
  name: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  hours: string;
  offersLabCollection: boolean;
  latitude: number | null;
  longitude: number | null;
  /** Pasted Google Maps share link. Optional. */
  mapsUrl: string;
  /** Settlement account. All optional at creation. */
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  isActive: boolean;
}

/** A catalogue product's admin state — mirrors `app.product.status`. */
export type ProductStatus = 'active' | 'inactive';

/** One storefront category group — a row of `app.product_category`. */
export interface ProductCategory {
  id: string;
  slug: string;
  title: string;
}

/**
 * One sub-category under a category — a row of `app.product_subcategory`, e.g.
 * "Skin Care" under "Personal Care". Seeded from the app's category browser by
 * migration 0004; `categorySlug` is the parent's slug.
 */
export interface ProductSubcategory {
  id: string;
  categorySlug: string;
  label: string;
}

/**
 * One sub-category, fully editable — the "Category banners" page's view of an
 * `app.product_subcategory` row, nested under its `CategoryGroupAdmin`.
 */
export interface SubcategoryAdmin {
  id: string;
  label: string;
  /** One of the closed icon vocabulary in `src/lib/categoryIcons.ts` — what
   *  the sub-category card shows until an [image] is uploaded, and again if
   *  that image ever fails to load. */
  iconName: string;
  /** The tile artwork on the sub-category card in the home "Shop by
   *  categories" panel and the Categories tab — a resized WebP/PNG data URI
   *  (transparency kept, the card is tinted), or '' to show [iconName]. May
   *  also be a bundled asset path on rows seeded before uploads existed. */
  image: string;
  offer: string;
  sort: number;
}

/**
 * One category group, fully editable — `app.product_category` plus its
 * `app.product_subcategory` rows. What the "Category banners" console page
 * lists and edits; the app reads the same table read-only via
 * `CategoryRepository`.
 */
export interface CategoryGroupAdmin {
  id: string;
  slug: string;
  title: string;
  /** Pre-wrapped chip caption on the home strip, e.g. "Personal\nCare". */
  tabLabel: string;
  /** From the closed vocabulary in `src/lib/categoryIcons.ts` — what the
   *  home strip chip shows until a chip [image] is uploaded, and again if
   *  that image ever fails to load. */
  iconName: string;
  /** The artwork on this group's chip on the home "Shop by categories" strip
   *  — a resized WebP/PNG data URI (transparency kept, the chip is tinted),
   *  or '' to show [iconName]. Separate from [bannerImage]. */
  image: string;
  /** The promotional banner shown at the top of this group's listing — a
   *  resized JPEG data URI, or '' for none. Separate from the chip [image]
   *  and the sub-category tile images. */
  bannerImage: string;
  /** One of the named pastel tints in `src/lib/categoryIcons.ts`. */
  panelTint: string;
  offer: string;
  sort: number;
  isActive: boolean;
  subcategories: SubcategoryAdmin[];
}

/** The editable fields of a [CategoryGroupAdmin] — everything but the id and
 *  its subcategories, which are saved separately. */
export interface NewCategoryGroup {
  slug: string;
  title: string;
  tabLabel: string;
  iconName: string;
  image: string;
  bannerImage: string;
  panelTint: string;
  offer: string;
  sort: number;
  isActive: boolean;
}

/** The editable fields of a [SubcategoryAdmin] — everything but the id. */
export interface NewSubcategory {
  label: string;
  iconName: string;
  image: string;
  offer: string;
  sort: number;
}

/** One question/answer pair for a product's detail-page FAQ (`app.product_faq`). */
export interface ProductFaqInput {
  question: string;
  answer: string;
}

/**
 * The rich detail-page content for a product — `app.product_detail` plus its
 * `app.product_faq` rows.
 *
 * Every field is optional for the admin. The customer app fills any blank in
 * with text generated from the product's name and pack, so a product with an
 * all-blank detail block still shows a complete page. The list fields
 * (`highlights`, `benefits`, `directions`, `safety`) are captured as one
 * textarea each, one item per line; `createProduct` splits them into `text[]`.
 */
export interface ProductDetailInput {
  /** Dosage form / kind — "Tablet", "Syrup", "Cream", "Device", … */
  form: string;
  manufacturer: string;
  description: string;
  ingredients: string;
  storage: string;
  /** Newline-separated; one bullet per line. */
  highlights: string;
  benefits: string;
  directions: string;
  safety: string;
  faqs: ProductFaqInput[];
}

/** Fields the admin fills to add a product to the catalogue. */
export interface NewProduct {
  categorySlug: string;
  /** `app.product_subcategory.id`, or '' when the category has no sub-categories. */
  subcategoryId: string;
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
  /** A resized JPEG data URI from the picked file, or '' for no image. */
  image: string;
  /** Home-feed placement — `app.product.is_popular` / `is_deal` / `is_offer_of_day`. */
  isPopular: boolean;
  isDeal: boolean;
  isOfferOfDay: boolean;
  /** Detail-page content. Written to `app.product_detail` / `app.product_faq`. */
  detail: ProductDetailInput;
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
  /** `app.product_subcategory.id`, or '' when unfiled. */
  subcategoryId: string;
  /** `app.product_subcategory.label`, or '' when unfiled. */
  subcategoryLabel: string;
  price: number;
  mrp: number;
  discountLabel: string;
  isPrescriptionOnly: boolean;
  status: ProductStatus;
  stockQuantity: number;
  /** `app.product.image` — a resized JPEG data URI, or '' when none. */
  image: string;
  /** Home-feed placement flags. */
  isPopular: boolean;
  isDeal: boolean;
  isOfferOfDay: boolean;
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

/** `app.fulfillment_type` — how the order reaches the member (migration 0031). */
export type FulfillmentType = 'home_delivery' | 'store_pickup';

/** `app.order_payment_status` — whether the order/bill has actually been paid. */
export type PaymentStatus = 'pending' | 'paid';

/**
 * `app.order_line_status` — the counter's own note on one order line, migration
 * 0044. Set from the Orders review modal; never read or shown by the member's app.
 */
export type OrderLineStatus =
  | 'available'
  | 'out_of_stock'
  | 'not_possible'
  | 'customer_not_needed';

/** One row of `app.order_line`. */
export interface OrderLine {
  id: string;
  /** Counter-only stock status; only 'available' lines pre-fill the bill. */
  status: OrderLineStatus;
  name: string;
  pack: string;
  unitPrice: number;
  mrp: number;
  qty: number;
}

/** The payment receipt a member attached at checkout — `app.order_receipt`. */
export interface OrderReceipt {
  payerName: string;
  reference: string;
  amount: number;
  fileName: string;
  /** The photo itself, a `data:` URI. Empty when none was captured. */
  image: string;
  uploadedAt: string;
}

/** One row of `app.bill_line` — a priced line on the invoice sent for an order. */
export interface BillLine {
  name: string;
  pack: string;
  unitPrice: number;
  qty: number;
}

/** A member's order — `app."order"` + `app.order_line`. */
export interface Order {
  id: string;
  code: string;
  /** `app.users.id` of the member — needed to save name/phone corrections. */
  memberId: string;
  memberName: string;
  memberPhone: string;
  kind: OrderKind;
  status: OrderStatus;
  itemCount: number;
  mrpTotal: number;
  paidTotal: number;
  deliveryFee: number;
  /** `app.order.store_id` as set on the order itself; '' when only the
   *  member's home branch (see [storeCode]) is known. */
  storeId: string;
  storeCode: string;
  storeName: string;
  /** When the counter submitted the review (Details step); '' until then. */
  reviewedAt: string;
  /** When the order was converted to a bill; '' until then. The Bills page
   *  lists only orders where this is set. */
  convertedToBillAt: string;
  /** When staff first used Call / WhatsApp for this order's member; '' until
   *  then. The member's app shows it as the "Store contact" stage. */
  storeContactedAt: string;
  paymentMethod: string;
  paymentMethodCode: string;
  /** `app.order.fulfillment_type` — home delivery vs store pickup (migration 0031). */
  fulfillmentType: FulfillmentType;
  /** `app.order.payment_status` — 'paid' the moment a wallet debit lands;
   *  stays 'pending' for cash until the delivery boy or store marks it collected. */
  paymentStatus: PaymentStatus;
  /** The delivery boy assigned to hand this off / collect cash for it, if any. */
  deliveryBoyId: string;
  deliveryBoyName: string;
  placedAt: string;
  lines: OrderLine[];
  /** The receipt the member submitted with this order, if any. */
  receipt: OrderReceipt | null;
  /** The invoice this store has sent back for the order, if any. */
  billImage: string;
  billedAt: string;
  /** What the bill says is owed — 0 until the store prices it (always known
   *  up front for a standard order; only set after intake for a prescription).
   *  Already net of [billDiscount] — this is what's actually collected. */
  billAmount: number;
  /** How much of the priced lines' subtotal was knocked off to reach
   *  [billAmount] — 0 for a bill with no discount applied. */
  billDiscount: number;
  billStatus: PaymentStatus;
  billLines: BillLine[];
}

/** `app.prescription_status`. */
export type PrescriptionStatus =
  | 'awaiting_review'
  | 'read'
  | 'in_cart'
  | 'ordered';

/**
 * `app.prescription_medicine_status` — whether the pharmacist actually has
 * this line on hand, migration 0024. Migration 0025 added a fourth DB value,
 * 'ORDERED', later dropped from here as a choosable option — Postgres enums
 * can't have a value removed once added, so it still exists in the database
 * type itself (see backend/api's own schema, which still lists it — it has
 * to keep matching the real enum), it's just never offered or written by
 * this app any more. Confirmed live: no existing row uses it, so nothing
 * needed migrating when it was dropped here. Set and changed from the
 * console's intake-card editor like any other field on the row; purely an
 * internal note for the counter, never read or shown by the member's own
 * app.
 */
export type PrescriptionMedicineStatus =
  | 'available'
  | 'out_of_stock'
  | 'not_possible';

/** One row of `app.prescription_medicine` (dose is morning-afternoon-night). */
export interface PrescriptionMedicine {
  name: string;
  /** The dosage form — "Type" in the console's intake form (Tablet, Syrup,
   *  Capsule, …) — `app.prescription_medicine.pack`. */
  pack: string;
  doseMorning: number;
  doseAfternoon: number;
  doseNight: number;
  /** "Quantity" in the console's intake form — `total_units`. */
  totalUnits: number;
  /** How and when to take it, e.g. "Oral, after food" — `route_time`. */
  routeTime: string;
  status: PrescriptionMedicineStatus;
}

/** One row the pharmacist enters on the intake card in the console. */
export interface PrescriptionMedicineInput {
  name: string;
  /** "Type" in the form — the dosage form (Tablet, Syrup, Capsule, …). */
  pack: string;
  /** The three-digit morning-afternoon-night code, e.g. "101". */
  intake: string;
  /** "Quantity" in the form. */
  totalUnits: number;
  /** "Route & time" in the form, e.g. "Oral, after food". */
  routeTime: string;
  /** "Stock status" in the form — admin-only, never shown to the member. */
  status: PrescriptionMedicineStatus;
}

/** One photo of an uploaded prescription — `app.prescription_image`. */
export interface PrescriptionImage {
  id: string;
  /** A resized JPEG data URI. */
  image: string;
  /** Degrees clockwise (0/90/180/270) to display this image rotated by —
   *  fixed by a reviewer once, applied wherever it renders from then on.
   *  Independent per image, since only one page of a multi-page script may
   *  need fixing. */
  rotation: number;
}

/** An uploaded prescription — `app.prescription` + `app.prescription_medicine`. */
export interface Prescription {
  id: string;
  code: string;
  /** `app.prescription.member_id` — editing [memberName] / [memberPhone]
   *  writes straight to that member's `app.users` row, so the correction
   *  shows everywhere on their account, not just this prescription. */
  memberId: string;
  memberName: string;
  memberPhone: string;
  /** `app.prescription.patient_id` — editing [patientName] writes to that
   *  saved patient profile, so it also changes how they're named on that
   *  patient's other prescriptions and addresses. */
  patientId: string;
  patientName: string;
  doctor: string;
  fileName: string;
  /** Up to a handful of photos of the uploaded script, in upload order —
   *  `app.prescription_image` (migration 0040), a script is often more
   *  than one page. Empty when none were uploaded (a script phoned in). */
  images: PrescriptionImage[];
  /** Display label — "1 week", "12 days", "—". Read-only; edit through
   *  [durationToken] / [customDays] instead. */
  duration: string;
  /** Lowercase `app.medicine_duration` token ('one_week', 'fifteen_days',
   *  'one_month', 'two_months', 'three_months'), or '' if unset. */
  durationToken: string;
  /** Overrides [durationToken] when greater than 0 — a reviewer's own day
   *  count rather than one of the five fixed spans. */
  customDays: number;
  status: PrescriptionStatus;
  /** The branch actually pinned on `app.prescription.store_id`, or '' when
   *  unset — [storeCode] / [storeName] below fall further back to the pickup
   *  order's branch, then the member's home branch, but this is the id an
   *  edit to the branch dropdown writes to. */
  storeId: string;
  storeCode: string;
  storeName: string;
  createdAt: string;
  medicines: PrescriptionMedicine[];
  /** The `app."order"` (kind PRESCRIPTION) this script was submitted with —
   *  '' if none (shouldn't happen once uploaded via checkout, but the join
   *  is left-outer so a data gap doesn't hide the whole row). Pricing the
   *  bill for this prescription happens against this order id. */
  orderId: string;
  fulfillmentType: FulfillmentType;
  billAmount: number;
  billStatus: PaymentStatus;
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

/** One row of `app.region` / `app.state` / … — a pickable named slot. */
export interface GeoSlot {
  id: string;
  name: string;
  code: string;
}

/** `app.agent_approval`, lowercased. */
export type AgentApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * An `app.agent` row registered from the app and awaiting an admin's review —
 * the KYC the recruiter entered plus the level/parent they suggested. The
 * admin confirms or changes the position and approves, or rejects with a
 * reason.
 */
export interface PendingAgent {
  id: string;
  code: string;
  name: string;
  phone: string;
  /** The tier the recruiter picked — the admin may change it. */
  level: AgentLevel;
  /** Free-text place / slot name the recruiter chose. */
  area: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  aadhaar: string;
  pan: string;
  address: string;
  pincode: string;
  place: string;
  accountNumber: string;
  createdAt: string;
  /** The parent agent this recruit reports to, from `app.agent.parent_id`. */
  parentCode: string;
  parentName: string;
}

/**
 * One approved `app.agent` row — the "All agents" management view, distinct
 * from [PendingAgent]: this is who is actually live in the tree today,
 * not who is waiting to join it.
 */
export interface AgentRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  level: AgentLevel;
  /** Display name of the named slot this agent heads (a zone, a district, …
   *  a place name for a free-text `place` agent). */
  area: string;
  /** The real slot id [area] names, or null for the national agent or one on
   *  a free-text place. See `Agent.areaId`'s doc on the Flutter side. */
  areaId: string | null;
  /** Switched off by an admin — the safe "remove" this view offers instead
   *  of a hard delete. */
  active: boolean;
  parentId: string | null;
  parentCode: string;
  parentName: string;
  createdAt: string;
}

/** A patient a member added — one row of `app.patient`. */
export interface MemberPatient {
  id: string;
  name: string;
  /** `app.patient_relation`, lowercased — self / spouse / child / … */
  relation: string;
  /** `app.gender`, lowercased. */
  gender: string;
  /** ISO date. */
  dob: string;
  phone: string;
  address: string;
  abhaId: string;
  createdAt: string;
}

/** A delivery address a member saved — one row of `app.member_address`. */
export interface MemberAddress {
  id: string;
  /** `app.address_label`, lowercased — home / work / other. */
  label: string;
  receiver: string;
  house: string;
  area: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  isDefault: boolean;
  /** Name of the linked `app.patient`, or '' when the address is not tied to one. */
  patientName: string;
  createdAt: string;
}

/**
 * The full profile behind an [AppUser] — the registration fields the list does
 * not carry, plus the patients and addresses the member added. Loaded lazily
 * when the user's modal opens.
 */
export interface UserDetail {
  id: string;
  /** `app.gender`, lowercased, or ''. */
  gender: string;
  /** ISO date, or ''. */
  dob: string;
  address: string;
  place: string;
  pincode: string;
  state: string;
  rewardPoints: number;
  referralCode: string;
  /** Set when another member's own referral code brought this member in. */
  referredByName: string;
  referredByPhone: string;
  /** Set instead of the two above when an agent's own code (`SHD-…`) brought
   *  this member in — the two never both apply to the same member. */
  referredByAgentName: string;
  referredByAgentCode: string;
  /** ISO timestamp the member finished registration, or ''. */
  registrationCompletedAt: string;
  patients: MemberPatient[];
  addresses: MemberAddress[];
}

/** `app.lab_booking_status`. */
export type LabBookingStatus =
  | 'requested'
  | 'confirmed'
  | 'sample_collected'
  | 'report_ready'
  | 'cancelled';

/** Someone a lab booking is for — one row of `app.lab_booking_patient`. */
export interface LabBookingPatient {
  name: string;
  /** Years; null when neither the booking nor the saved patient records one. */
  age: number | null;
}

/** One page of a booking's lab report — one row of `app.lab_booking_report`. */
export interface LabReportPage {
  id: string;
  /** The picked file's name. */
  name: string;
  /** Resized JPEG data URI. */
  image: string;
}

/** A member's lab-test booking — one row of `app.lab_booking`. */
export interface LabBooking {
  id: string;
  code: string;
  memberName: string;
  memberPhone: string;
  packageName: string;
  /** The branch this booking is routed to (migration 0057) — '' for a
   *  booking made before branches existed, or whose branch has since gone. */
  storeCode: string;
  storeName: string;
  patientsCount: number;
  /** Who the tests are for (a saved patient's name, or a typed one). */
  patients: LabBookingPatient[];
  /** The collection address on one line, or '' when the booking has none. */
  address: string;
  /** Contact number saved on that address, or ''. */
  addressPhone: string;
  unitPrice: number;
  totalPrice: number;
  status: LabBookingStatus;
  scheduledFor: string;
  /** A line from the lab to the member; shown beside the booking in the app. */
  note: string;
  /** How many report pages are attached. */
  reportPages: number;
  reportUploadedAt: string;
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
  /** The Sahakar 360 branch serving the member. */
  storeName: string;
  scheduledFor: string;
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
}

/** "Explore by health concern" — one row of `app.lab_category` (migration
 *  0055), managed on the Lab Tests → Categories tab. */
export interface LabCategory {
  id: string;
  name: string;
  /** An uploaded data URI, or '' to show a plain placeholder tile. */
  image: string;
  sort: number;
  isActive: boolean;
  /** Active `lab_package` rows filed under this category — computed on read,
   *  never stored, so it can never drift from what Member packages shows. */
  testCount: number;
}

export interface NewLabCategory {
  name: string;
  image: string;
  sort: number;
  isActive: boolean;
}

/** A diagnostic package — one row of `app.lab_package`. */
export interface LabPackage {
  id: string;
  slug: string;
  name: string;
  /** '' when the package carries no category. */
  categoryId: string;
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
  preparation: string;
  about: string;
  isActive: boolean;
  addedAt: string;
}

/** What the package builder (Member packages → "+ New package") writes: a
 *  name, an optional category, pricing, and the real `app.lab_test` rows
 *  it's built from — `app.lab_package_test_item`, migration 0055. Each of
 *  [testIds] is a single test or a group test (never a package); a group
 *  becomes one named profile on the package, e.g. picking "Liver Function
 *  Test" puts it on the package as one line covering everything inside that
 *  group, not each of its own tests loose. The console derives
 *  `app.lab_profile` from [testIds] itself so the existing package-card
 *  rendering in both apps needs no changes to show it. */
export interface LabPackageInput {
  name: string;
  categoryId: string;
  price: number;
  mrp: number;
  forWhom: string;
  sample: string;
  preparation: string;
  reportIn: string;
  about: string;
  testIds: string[];
}

/** Where a lab test came from: made on the Test Master tab, or imported from
 *  the reference-lab rate list (offered when building a group, not listed under
 *  "Saved tests" by default). */
export type LabTestSource = 'ADMIN' | 'RATE_LIST';

/** `app.lab_test.test_type` — a single test, a group test, or a package. */
export type LabTestType = 'TEST' | 'GROUP' | 'PACKAGE';

export type LabReportUnit = 'Minutes' | 'Hours' | 'Days';

/** One test inside a group test / package (`app.lab_test_group_item`) — the
 *  "Set Grouptest" tab's row. `name`, `department` and `sample` are read from
 *  the member test for display only; they are never written back. */
export interface LabGroupItem {
  testId: string;
  name: string;
  department: string;
  sample: string;
  /** The price inside this group; starts at the test's own amount. */
  amount: number;
  setOrder: number;
  isSubhead: boolean;
}

/** A referring lab's own rate for a test (`app.lab_test_special_rate`). */
export interface LabSpecialRate {
  refLab: string;
  rate: number;
}

/** The editable fields of a lab test — everything on the LIS-style form
 *  except the tests inside it and its special rates, which travel beside it. */
export interface LabTestInput {
  testType: LabTestType;
  name: string;
  /** '' for none — the Test Master form's "Category" dropdown (migration 0055). */
  categoryId: string;
  /** The form's "Show in the app" switch (migration 0056): a test or group test
   *  that is on (and active) is offered to members under "Top Profiles and
   *  Tests" as its own bookable listing. Meaningless for a PACKAGE type. */
  showInApp: boolean;
  shortName: string;
  calcCode: string;
  division: string;
  department: string;
  method: string;
  unit: string;
  rate: number;
  discountPercent: number;
  /** Rate less the discount — what the patient pays. */
  amount: number;
  /** What the lab charges for the test; 0 when no lab rate is quoted. */
  labRate: number;
  sample: string;
  volume: string;
  /** When the test is run: 'Daily', or a weekday set like 'Tue, Thu, Sat'. */
  scheduledDays: string;
  /** The form's "Cut of time" field: the time samples must arrive by, e.g. '1 pm'. */
  cutOfTime: string;
  /** When the report is ready, as free text: 'Same Day', '3rd Day', '1 week'. */
  reportingTime: string;
  technology: string;
  testMode: string;
  reportOnValue: number;
  reportOnUnit: LabReportUnit;
  performAt: string;
  internalNote: string;
  nablAccredited: boolean;
  sendSms: boolean;
  sampleTypeBarcode: boolean;
  freeTest: boolean;
  avoidIncentive: boolean;
  alphanumericCritical: boolean;
  commonTechnology: boolean;
  avoidResultEntry: boolean;
  hideHead: boolean;
  editTestRate: boolean;
  ref1: string;
  ref2: string;
  specification1: string;
  specification2: string;
  specification3: string;
  resultTemplate: string;
  isActive: boolean;
}

/** A saved lab test — `app.lab_test` with its group members and special rates. */
export interface LabTest extends LabTestInput {
  id: string;
  lisCode: number;
  source: LabTestSource;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  groupItems: LabGroupItem[];
  specialRates: LabSpecialRate[];
}

/** One row of the saved-tests list: enough to find a test and load it. */
export interface LabTestSummary {
  id: string;
  lisCode: number;
  testType: LabTestType;
  name: string;
  shortName: string;
  department: string;
  method: string;
  sample: string;
  reportingTime: string;
  amount: number;
  labRate: number;
  source: LabTestSource;
  isActive: boolean;
  /** How many tests a group / package holds; 0 for a single test. */
  itemCount: number;
}

/** One row the package builder's test picker offers — a single test or a
 *  group test built earlier on the Test Master's own "Set Grouptest" tab
 *  (never a PACKAGE, so a package can't nest another package inside itself).
 *  Choosing a group ("Liver Function Test", say) puts the whole panel on the
 *  package as one profile, named after the group itself, the same way a real
 *  lab packages a named panel rather than listing every marker loose. */
export interface LabTestPickerRow {
  id: string;
  lisCode: number;
  testType: LabTestType;
  name: string;
  department: string;
  sample: string;
  amount: number;
  /** How many individual tests a GROUP holds (0 for a plain TEST — it is
   *  already the one test). What the profile's "· N parameters" is read from. */
  itemCount: number;
}

/** `app.approval_status`, as the activations screen uses it. */
export type PrivilegeActivationStatus =
  | 'pending'
  | 'approved'
  | 'partially_approved'
  | 'rejected'
  | 'cancelled'
  /** Neither approved nor rejected yet — the admin needs something more from
   *  the member (a clearer receipt, a matching amount) before deciding.
   *  Still actionable: approving or rejecting from here works the same as
   *  from `pending`. */
  | 'on_hold';

/**
 * A privilege-plan activation a member submitted from the app — one row of
 * `app.wallet_card`. Lands as `pending`; a Super Admin approves it (which
 * writes the wallet ledger and moves the balance) or rejects it with a note.
 */
export interface PrivilegeActivation {
  id: string;
  uuid: string;
  /** `app.wallet.member_id` — the `app.users` id, for grouping a member's plans. */
  memberId: string;
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
  /** `app.wallet_card.receipt_image` — a base64 data URI of the transfer
   *  screenshot, or '' when the member submitted before images were captured. */
  receiptImage: string;
  reviewerNote: string;
  submittedAt: string;
  /** When the plan was taken out, and when its validity runs out. Only
   *  meaningful once `status` is `approved` — see `ActivationDetailPage`. */
  issuedOn: string;
  expiresOn: string;
  reviewedAt?: string;

  // ---- The reviewer's own verification checklist (migration 0054) ---------
  // Separate from what the member submitted above (`receiptReference`,
  // `receiptFileName`, `receiptImage`). All four are required before Approve
  // is enabled — see `ActivationDetailPage`'s own doc.
  /** The UTR / transaction id the admin read off their own bank statement. */
  verifiedReference: string;
  /** When the admin actually saw the transfer land. */
  receivedOn: string;
  /** The admin has looked at the uploaded receipt image and it checks out. */
  receiptVerified: boolean;
  /** What the admin saw credited — compared against `amount`. */
  receivedAmount: number;
}

/**
 * A member's wallet at a glance, for the activation review panel — deliberately
 * just the headline figures, not the ledger: the review screen shows what the
 * plan will land on top of, never the member's transaction history.
 */
export interface WalletActivity {
  balance: number;
  rewardPoints: number;
}

/**
 * The home-screen hero banner — `app.home_banner` — shown at the top of the
 * app and web build, below the search bar. Members see only `isActive` rows,
 * nearest-to-front first by `sort`.
 */
export interface HomeBanner {
  id: string;
  title: string;
  subtitle: string;
  /** A data: URI (uploaded here) or an http(s) URL. */
  image: string;
  /** Button caption shown on the banner, e.g. "Shop now" — blank hides it. */
  cta: string;
  /** Where the CTA leads — a route the app recognises, or a full URL. */
  target: string;
  isActive: boolean;
  /** Display order, lowest first. */
  sort: number;
  createdAt: string;
}

/** The editable fields of a [HomeBanner] — everything but the id and stamp. */
export interface NewHomeBanner {
  title: string;
  subtitle: string;
  image: string;
  cta: string;
  target: string;
  isActive: boolean;
  sort: number;
}

/**
 * One clip in "What our customers have to say" on the home feed —
 * `app.customer_review_video`. `videoUrl` is either a bundled app asset path
 * (the clips seeded at launch) or an http(s) URL to a hosted video (anything
 * an admin adds from here).
 */
export interface CustomerReviewVideo {
  id: string;
  name: string;
  subtitle: string;
  videoUrl: string;
  /** A data: URI or an http(s) URL — the poster frame, or '' for none. */
  thumbnail: string;
  isActive: boolean;
  /** Display order, lowest first. */
  sort: number;
  createdAt: string;
}

/** Fields the admin fills to add or edit a customer review clip. */
export interface NewCustomerReviewVideo {
  name: string;
  subtitle: string;
  videoUrl: string;
  thumbnail: string;
  isActive: boolean;
  sort: number;
}

/**
 * The money-in side of the Accounts page — every source of cash actually
 * collected. Excludes cancelled orders/bookings/appointments and pending
 * privilege-plan activations (nothing has changed hands yet on those).
 */
export interface RevenueBreakdown {
  ordersTotal: number;
  ordersCount: number;
  labBookingsTotal: number;
  labBookingsCount: number;
  appointmentsTotal: number;
  appointmentsCount: number;
  privilegeLoadsTotal: number;
  privilegeLoadsCount: number;
  total: number;
}

/** The money-out side — payouts actually made, not merely requested. */
export interface PayoutBreakdown {
  agentWithdrawalsTotal: number;
  agentWithdrawalsCount: number;
  total: number;
}

/** The whole-app money-flow snapshot the Accounts page opens on. */
export interface MoneyFlowSummary {
  revenue: RevenueBreakdown;
  payouts: PayoutBreakdown;
  /** revenue.total − payouts.total. */
  net: number;
  /** Sum of every member wallet's balance — cash the app still owes out. */
  walletLiability: number;
  /** Requested but not yet paid — shown as a heads-up, not counted in payouts. */
  pendingAgentWithdrawalsTotal: number;
  pendingAgentWithdrawalsCount: number;
}

/** One bucket of the last-6-months money-flow chart. */
export interface MonthlyMoneyFlow {
  /** e.g. "Mar 2026". */
  month: string;
  in: number;
  out: number;
}

/** What kind of event one row of the combined money-flow ledger is. */
export type MoneyFlowKind =
  | 'order'
  | 'lab_booking'
  | 'appointment'
  | 'privilege_load'
  | 'agent_payout';

/** One row of the combined money-flow ledger — every source, one timeline. */
export interface MoneyFlowEntry {
  id: string;
  kind: MoneyFlowKind;
  direction: 'in' | 'out';
  amount: number;
  /** A short reference — order code, member/agent name, plan tier. */
  label: string;
  /** Who the money moved with. */
  detail: string;
  occurredAt: string;
}
