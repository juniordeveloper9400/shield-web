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

/** `AgentLevel` (upper- or lower-case) -> the geo table it names a row in. */
const GEO_TABLE_BY_LEVEL: Record<string, string> = {
  REGION: 'region',
  STATE: 'state',
  DISTRICT: 'district',
  ASSEMBLY: 'assembly',
  LSGD: 'lsgd',
  WARD: 'ward',
};

/**
 * Recomputes `app.<table for level>.agent_id` for [areaId] from whichever
 * approved agent (if any) currently has that `area_id` — a denormalized
 * mirror of `app.agent.area_id` living on the geo row itself, so "who heads
 * this slot" is answerable straight from `app.region`/`state`/… without a
 * join. `app.agent.area_id` stays the one source of truth; this only ever
 * copies it outward.
 *
 * No-op for `national` (no geo row to update) or a null [areaId]. Call it
 * for the slot an agent is leaving as well as the one they're joining —
 * `updateAgentPosition` needs both; a fresh approval or conversion only
 * ever needs the one they're joining.
 */
export async function resyncGeoSlotAgent(
  level: string,
  areaId: string | null | undefined,
): Promise<void> {
  const table = GEO_TABLE_BY_LEVEL[level.toUpperCase()];
  if (!table || !areaId) return;
  await query(
    `UPDATE app.${table} t
       SET agent_id = (
         SELECT a.id FROM app.agent a
          WHERE a.area_id = t.id AND a.approval_status = 'APPROVED'
          LIMIT 1
       )
     WHERE t.id = $1`,
    [areaId],
  );
}

// ---- deriving the correct parent from geography -------------------------
//
// The console's "Parent agent" picker is a free choice, defaulting to "(top
// of tree)" — nothing forces an admin to actually pick the region a new
// state agent's zone sits in, say. Left that way, the agent is unreachable
// from anyone's "My Team" above them even though they plainly belong under
// whoever heads that region: reported earnings/customers/team-size roll up
// through parent_id, not through the geo hierarchy an agent's own area_id
// already places them in. These queries answer "who *should* this agent's
// parent be" from geography, for whichever tier is left unset.

/** One query per tier, walking from its own geo table up through region,
 *  nearest ancestor first — a0 is the tier directly above, a1 the one above
 *  that, and so on. LEFT JOINs throughout: lsgd.assembly_id is nullable (a
 *  handful of large corporations span more than one assembly), so the walk
 *  from a ward or lsgd can run out partway up rather than fail outright. */
const ANCESTOR_AGENT_QUERY: Record<string, string> = {
  STATE: `
    SELECT r.agent_id::text AS a0
    FROM app.state s
    JOIN app.region r ON r.id = s.region_id
    WHERE s.id = $1`,
  DISTRICT: `
    SELECT s.agent_id::text AS a0, r.agent_id::text AS a1
    FROM app.district d
    JOIN app.state s  ON s.id = d.state_id
    JOIN app.region r ON r.id = s.region_id
    WHERE d.id = $1`,
  ASSEMBLY: `
    SELECT d.agent_id::text AS a0, s.agent_id::text AS a1, r.agent_id::text AS a2
    FROM app.assembly ay
    JOIN app.district d ON d.id = ay.district_id
    JOIN app.state s    ON s.id = d.state_id
    JOIN app.region r   ON r.id = s.region_id
    WHERE ay.id = $1`,
  LSGD: `
    SELECT ay.agent_id::text AS a0, d.agent_id::text AS a1,
           s.agent_id::text AS a2, r.agent_id::text AS a3
    FROM app.lsgd l
    LEFT JOIN app.assembly ay ON ay.id = l.assembly_id
    LEFT JOIN app.district d  ON d.id = ay.district_id
    LEFT JOIN app.state s     ON s.id = d.state_id
    LEFT JOIN app.region r    ON r.id = s.region_id
    WHERE l.id = $1`,
  WARD: `
    SELECT l.agent_id::text AS a0, ay.agent_id::text AS a1, d.agent_id::text AS a2,
           s.agent_id::text AS a3, r.agent_id::text AS a4
    FROM app.ward w
    JOIN app.lsgd l ON l.id = w.lsgd_id
    LEFT JOIN app.assembly ay ON ay.id = l.assembly_id
    LEFT JOIN app.district d  ON d.id = ay.district_id
    LEFT JOIN app.state s     ON s.id = d.state_id
    LEFT JOIN app.region r    ON r.id = s.region_id
    WHERE w.id = $1`,
};

/** The one live national agent, or null (none yet, or more than one —
 *  ambiguous, so this stays out of the way rather than guessing). */
async function soleNationalAgentId(): Promise<string | null> {
  const rows = await query<Row>(
    `SELECT id::text AS id FROM app.agent
      WHERE level = 'NATIONAL' AND approval_status = 'APPROVED'`,
  );
  return rows.length === 1 ? String(rows[0].id) : null;
}

/**
 * Who [level] + [areaId]'s agent should report to, purely from where their
 * slot sits in the geo hierarchy — the region agent for a state, the state
 * agent for a district, and so on, walking up past any tier with nobody in
 * it yet, down to the national agent as the last resort. Null when there is
 * nobody to derive a parent from (national itself, a free-text-place agent
 * with no areaId, or no national agent yet either).
 *
 * This is a default, not an override — callers only fall back to it when
 * the admin left "Parent agent" unset, so an explicit choice always wins.
 */
export async function deriveParentAgentId(
  level: string,
  areaId: string | null | undefined,
): Promise<string | null> {
  const lvl = level.toUpperCase();
  if (lvl === 'NATIONAL') return null;
  if (lvl !== 'REGION' && areaId) {
    const sql = ANCESTOR_AGENT_QUERY[lvl];
    if (sql) {
      const [row] = await query<Row>(sql, [areaId]);
      if (row) {
        const found = [row.a0, row.a1, row.a2, row.a3, row.a4].find(
          (v) => v != null,
        );
        if (found != null) return String(found);
      }
    }
  }
  // A region (nothing geographically above it but national), or the walk
  // ran out with no agent at any tier above -- the national agent, if
  // there's exactly one to be unambiguous about.
  return soleNationalAgentId();
}
