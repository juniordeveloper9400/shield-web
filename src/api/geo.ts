import { api } from '@/lib/api';
import type { GeoSlot } from '@/types';

/** A `GET /v1/public/geo/...` row — the raw columns Drizzle's `.select()`
 *  returns, a superset of what {@link GeoSlot} needs. */
interface GeoApiRow {
  id: string;
  name: string;
  code: string;
  wardNumber?: number | null;
}

function toSlot(r: GeoApiRow): GeoSlot {
  return { id: String(r.id), name: String(r.name ?? ''), code: String(r.code ?? '') };
}

/**
 * The six fixed zones a region agent heads — nothing above them to pick.
 * Reads through `backend/api`'s public, edge-cached geo routes
 * (`GET /v1/public/geo/...`, see `GeoController`) rather than Neon
 * directly — same near-static `app.region`…`app.ward` tables the admin
 * console used to query itself.
 */
export async function listRegions(): Promise<GeoSlot[]> {
  const rows = await api.get<GeoApiRow[]>('/v1/public/geo/regions');
  return rows.map(toSlot);
}

export async function listStates(regionId: string): Promise<GeoSlot[]> {
  const rows = await api.get<GeoApiRow[]>(`/v1/public/geo/regions/${regionId}/states`);
  return rows.map(toSlot);
}

export async function listDistricts(stateId: string): Promise<GeoSlot[]> {
  const rows = await api.get<GeoApiRow[]>(`/v1/public/geo/states/${stateId}/districts`);
  return rows.map(toSlot);
}

export async function listAssemblies(districtId: string): Promise<GeoSlot[]> {
  const rows = await api.get<GeoApiRow[]>(`/v1/public/geo/districts/${districtId}/assemblies`);
  return rows.map(toSlot);
}

export async function listLsgds(assemblyId: string): Promise<GeoSlot[]> {
  const rows = await api.get<GeoApiRow[]>(`/v1/public/geo/assemblies/${assemblyId}/lsgds`);
  return rows.map(toSlot);
}

/**
 * Unlike the other five, the backend's drill-down route hands back a
 * ward's raw (possibly blank) `name` — only its flattened `/tree` route
 * applies the "Ward N" fallback server-side (see `GeoService.listTree`).
 * Applied here instead, matching exactly what this module's own SQL used
 * to do (`coalesce(nullif(name, ''), 'Ward ' || ward_number)`).
 */
export async function listWards(lsgdId: string): Promise<GeoSlot[]> {
  const rows = await api.get<GeoApiRow[]>(`/v1/public/geo/lsgds/${lsgdId}/wards`);
  return rows.map((r) =>
    toSlot({ ...r, name: r.name || (r.wardNumber ? `Ward ${r.wardNumber}` : '') }),
  );
}

/**
 * The geographic tiers that carry a real slot — `national` has none, so it
 * is not one of these. Matches `AgentLevel` minus `'national'`, in order.
 */
export type GeoTier = 'region' | 'state' | 'district' | 'assembly' | 'lsgd' | 'ward';

export const GEO_TIER_ORDER: GeoTier[] = [
  'region',
  'state',
  'district',
  'assembly',
  'lsgd',
  'ward',
];

/**
 * The options for [tier], scoped under [parentId] — the slot chosen at the
 * tier above. `region` has no parent (there is nothing above it); every
 * other tier returns no options until its parent is chosen, same as the
 * app's own cascading pickers.
 */
export function listSlots(tier: GeoTier, parentId: string | null): Promise<GeoSlot[]> {
  switch (tier) {
    case 'region':
      return listRegions();
    case 'state':
      return parentId ? listStates(parentId) : Promise.resolve([]);
    case 'district':
      return parentId ? listDistricts(parentId) : Promise.resolve([]);
    case 'assembly':
      return parentId ? listAssemblies(parentId) : Promise.resolve([]);
    case 'lsgd':
      return parentId ? listLsgds(parentId) : Promise.resolve([]);
    case 'ward':
      return parentId ? listWards(parentId) : Promise.resolve([]);
  }
}
