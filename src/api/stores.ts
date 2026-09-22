import { api } from '@/lib/api';
import { isoRequired, num } from '@/lib/mappers';
import type { NewStore, Store } from '@/types';

/** The shape `GET/POST/PATCH /v1/staff/catalogue/stores*` sends back —
 *  CatalogueService's drizzle rows, camelCase, `numeric` columns as strings
 *  (Postgres convention, same as every other numeric this console reads). */
interface StoreApiRow {
  id: number;
  code: string;
  name: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  hours: string;
  isActive: boolean;
  offersLabCollection: boolean;
  latitude: string | null;
  longitude: string | null;
  mapsUrl: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  createdAt: string;
  memberCount: number;
  orderCount: number;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStore(r: StoreApiRow): Store {
  return {
    id: String(r.id),
    code: r.code,
    name: r.name,
    area: r.area,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    phone: r.phone,
    hours: r.hours,
    isActive: r.isActive,
    offersLabCollection: r.offersLabCollection,
    latitude: numOrNull(r.latitude),
    longitude: numOrNull(r.longitude),
    mapsUrl: r.mapsUrl,
    bankAccountName: r.bankAccountName,
    bankAccountNumber: r.bankAccountNumber,
    bankIfsc: r.bankIfsc,
    bankName: r.bankName,
    memberCount: num(r.memberCount),
    orderCount: num(r.orderCount),
    openedAt: isoRequired(r.createdAt),
  };
}

/**
 * Every Sahakar 360 branch, with its live member and order counts —
 * `GET /v1/staff/catalogue/stores` (`CatalogueService.listStoresForStaff`),
 * migrated off direct Neon; see backend/docs/migration-plan.md Phase 1. Open
 * to any staff role (branch pickers on Bills/Deliveries/order and
 * prescription review need it too), not just the roles that can write.
 */
export async function listStores(token: string | null): Promise<Store[]> {
  const rows = await api.get<StoreApiRow[]>('/v1/staff/catalogue/stores', token);
  return rows.map(toStore);
}

export async function setStoreActive(id: string, isActive: boolean, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/catalogue/stores/${id}/active`, { isActive }, token);
}

/** Whether this branch takes lab bookings at all (migration 0057) — drops it
 *  from the app's branch picker at lab checkout the moment it's off. */
export async function setStoreOffersLab(id: string, offersLab: boolean, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/catalogue/stores/${id}/offers-lab`, { offersLabCollection: offersLab }, token);
}

export async function updateStore(
  id: string,
  patch: {
    name: string;
    phone: string;
    hours: string;
    area: string;
    city: string;
    state: string;
    pincode: string;
    latitude: number | null;
    longitude: number | null;
    mapsUrl: string;
    bankAccountName: string;
    bankAccountNumber: string;
    bankIfsc: string;
    bankName: string;
    offersLabCollection: boolean;
  },
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/catalogue/stores/${id}`, patch, token);
}

/**
 * Opens a new branch. Available to the customer app (APK + web) the moment it
 * is written — the app reads `app.shield_store` for its branch directory.
 * Returns the new id, or `null` when the code is already taken.
 */
export async function createStore(s: NewStore, token: string | null): Promise<string | null> {
  const { store } = await api.post<{ store: StoreApiRow | null }>('/v1/staff/catalogue/stores', s, token);
  return store ? String(store.id) : null;
}
