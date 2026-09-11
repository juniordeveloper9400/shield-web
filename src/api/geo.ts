import { query } from '@/lib/db';
import type { GeoSlot } from '@/types';

type Row = Record<string, unknown>;

function toSlot(r: Row): GeoSlot {
  return { id: String(r.id), name: String(r.name ?? ''), code: String(r.code ?? '') };
}

/** The six fixed zones a region agent heads — nothing above them to pick. */
export async function listRegions(): Promise<GeoSlot[]> {
  const rows = await query<Row>(
    `SELECT id, name, code FROM app.region ORDER BY sort, name`,
  );
  return rows.map(toSlot);
}

export async function listStates(regionId: string): Promise<GeoSlot[]> {
  const rows = await query<Row>(
    `SELECT id, name, code FROM app.state WHERE region_id = $1 ORDER BY sort, name`,
    [regionId],
  );
  return rows.map(toSlot);
}

export async function listDistricts(stateId: string): Promise<GeoSlot[]> {
  const rows = await query<Row>(
    `SELECT id, name, code FROM app.district WHERE state_id = $1 ORDER BY sort, name`,
    [stateId],
  );
  return rows.map(toSlot);
}

export async function listAssemblies(districtId: string): Promise<GeoSlot[]> {
  const rows = await query<Row>(
    `SELECT id, name, code FROM app.assembly WHERE district_id = $1 ORDER BY sort, name`,
    [districtId],
  );
  return rows.map(toSlot);
}

export async function listLsgds(assemblyId: string): Promise<GeoSlot[]> {
  const rows = await query<Row>(
    `SELECT id, name, code FROM app.lsgd WHERE assembly_id = $1 ORDER BY sort, name`,
    [assemblyId],
  );
  return rows.map(toSlot);
}

export async function listWards(lsgdId: string): Promise<GeoSlot[]> {
  const rows = await query<Row>(
    `SELECT id, coalesce(nullif(name, ''), 'Ward ' || ward_number) AS name, code
     FROM app.ward WHERE lsgd_id = $1 ORDER BY sort, ward_number`,
    [lsgdId],
  );
  return rows.map(toSlot);
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
